"""
Leitura dos prints de videoaula: OCR + análise de cor.

Roda dentro do container, sem rede. Recebe uma imagem por linha no stdin
(JSON) e devolve um frame por linha no stdout, conforme fica pronto — é o que
faz as questões aparecerem uma a uma na tela em vez de todas no fim.

A parte que não é OCR é a que importa. Nestes slides existem dois vermelhos com
significados opostos:

  - o professor sublinha termos do enunciado com caneta vermelha. O traço fica
    embaixo da linha de base; o glifo continua preto.
  - o slide revela o gabarito repintando a alternativa inteira de vermelho. Aí
    são os próprios glifos que mudam de cor.

Nenhum modelo precisa julgar isso: é medir a cor dos pixels do texto (gabarito)
contra a cor dos pixels logo abaixo dele (sublinhado). Duas medidas diferentes,
determinísticas, de graça.
"""

from __future__ import annotations

import base64
import io
import json
import re
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import numpy as np
import pytesseract
from PIL import Image
from pytesseract import Output

IDIOMA = "por"

# psm 3 = página com blocos; psm 6 = bloco único de texto. O slide em tela
# cheia sai melhor no 3; o slide dentro do vídeo, cercado pela cena, costuma
# sair melhor no 6. Tentamos os dois e ficamos com o que achar mais alternativas.
MODOS = ("--psm 3", "--psm 6")

CONFIANCA_MINIMA = 35

LEITURAS_PARALELAS = 4

# ---------------------------------------------------------------- cores

# Um pixel é "tinta" quando é escuro o bastante para ser traço, e não fundo.
LIMITE_TINTA = 165
# Vermelho de verdade: o canal R domina os outros com folga.
FOLGA_VERMELHO = 45
# Fundo colorido (marca-texto): claro, mas longe do cinza.
SATURACAO_MARCA = 32

# O logo do cursinho encosta na linha do cabeçalho, e o Tesseract lê os dois
# como uma linha só: "5. Guarda Port. / DOCAS-BA p Estratégia". Descartar a
# linha levaria o cabeçalho junto, então estas duas palavras saem sozinhas.
MARCA_DO_CURSO = re.compile(r"^(estrategia|concursos)$", re.IGNORECASE)

# Rodapé do slide, telas de recado e sobras do logo. "cursos" sozinho numa
# linha é a metade de "Concursos" que o OCR separou: como linha inteira nunca é
# conteúdo do slide, e deixá-la passar empurra o cabeçalho para dentro do
# enunciado — o que muda a chave de agrupamento e duplica a questão.
RODAPE = re.compile(
    r"^\W*$|profherbertalmeida|^prof[aª°]?\b|anota\s*ai|^(con)?cursos?$|^estrategia$",
    re.IGNORECASE,
)

# Sobras de ícone que o OCR lê como letra solta. As monossílabas de verdade do
# português ficam.
SOZINHAS_VALIDAS = set("aàáoóeéuú")

ALTERNATIVA = re.compile(r"^\s*([A-Ea-e])\s*[)\.\-–]\s*(.+)$")

BANCAS = {
    "FCC", "CESPE", "CEBRASPE", "FGV", "VUNESP", "IBFC", "QUADRIX", "AOCP",
    "IADES", "CONSULPLAN", "FUNDATEC", "IDECAN", "CESGRANRIO", "ESAF",
    "FUMARC", "SELECON", "INSTITUTO AOCP", "IBADE", "AVANCASP", "OBJETIVA",
}

# Continuação de cabeçalho: a linha quebrou no meio de um sintagma.
PENDURADO = re.compile(r"(?:\b(?:de|da|do|das|dos|em|e|a|o|para|com|no|na)|[-–,])\s*$", re.I)


def sem_acento(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    )


def frame_vazio(motivo: str | None = None) -> dict[str, Any]:
    return {
        "tipo": "ignorar",
        "motivo_ignorar": motivo,
        "banca": None,
        "ano": None,
        "orgao": None,
        "prova": None,
        "materia": None,
        "assunto": None,
        "texto_assoc": None,
        "enunciado": "",
        "alternativas": {},
        "gabarito": None,
        "gabarito_evidencia": None,
        "cortada": False,
        "observacao": None,
    }


# ---------------------------------------------------------------- medidas


# Acima disto o pixel é fundo, não traço. Usado só para limpar a imagem que
# vai ao OCR — a análise de cor continua olhando o original.
LIMITE_FUNDO = 110


class Tela:
    """A imagem como matriz, com as medidas de cor usadas pelo resto."""

    def __init__(self, imagem: Image.Image) -> None:
        self.rgb = np.asarray(imagem.convert("RGB"), dtype=np.int16)
        self.altura, self.largura = self.rgb.shape[:2]

    def para_ocr(self) -> Image.Image:
        """
        Cópia com o fundo achatado em branco.

        O marca-texto ciano do slide baixa o contraste o bastante para o
        Tesseract simplesmente não devolver as palavras grifadas — e some do
        enunciado justamente o trecho que o professor quis destacar. Zerar o
        fundo devolve preto sobre branco. O `self.rgb` original fica intacto,
        porque é dele que sai a cor do gabarito e do sublinhado.
        """
        limpa = self.rgb.copy()
        limpa[limpa.min(axis=-1) > LIMITE_FUNDO] = 255
        return Image.fromarray(limpa.astype(np.uint8), "RGB")

    def recorte(self, x: int, y: int, w: int, h: int) -> np.ndarray:
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(self.largura, x + w), min(self.altura, y + h)
        if x1 <= x0 or y1 <= y0:
            return np.zeros((0, 0, 3), dtype=np.int16)
        return self.rgb[y0:y1, x0:x1]

    @staticmethod
    def _vermelhos(area: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Máscara de tinta e, dentro dela, máscara do que é vermelho."""
        if area.size == 0:
            return np.zeros(0, dtype=bool), np.zeros(0, dtype=bool)
        r, g, b = area[..., 0], area[..., 1], area[..., 2]
        tinta = area.min(axis=-1) < LIMITE_TINTA
        vermelho = (r - np.maximum(g, b)) > FOLGA_VERMELHO
        return tinta, tinta & vermelho

    def fracao_vermelha(self, caixa: tuple[int, int, int, int]) -> float:
        """
        Quanto da tinta desta caixa é vermelha — só no topo da caixa.

        O corte em 70% da altura é o que separa os dois vermelhos: o sublinhado
        do professor mora na base da caixa, e contá-lo aqui faria uma palavra
        curta como "o" parecer escrita em vermelho.
        """
        x, y, w, h = caixa
        area = self.recorte(x, y, w, max(1, int(h * 0.7)))
        tinta, vermelha = self._vermelhos(area)
        total = int(tinta.sum())
        return float(vermelha.sum()) / total if total >= 12 else 0.0

    def sublinhada(self, caixa: tuple[int, int, int, int]) -> bool:
        """
        Traço colorido rente à base da palavra, fora dos glifos.

        O limiar é baixo porque o professor sublinha sílaba: em "explorá-la" o
        traço pega só o "la", um quarto da largura da palavra. O que segura o
        falso positivo não é a largura exigida, e sim a cor — vermelho de
        caneta, com o canal R dominando, não aparece por acidente num slide de
        texto preto.
        """
        x, y, w, h = caixa
        faixa = max(4, int(h * 0.38))
        area = self.recorte(x, y + h - max(1, int(h * 0.14)), w, faixa)
        if area.size == 0:
            return False

        _, vermelha = self._vermelhos(area)
        if vermelha.size == 0:
            return False

        # Um traço é contínuo na horizontal: contamos colunas atingidas, não
        # pixels soltos, para não confundir com ruído de compressão.
        colunas_marcadas = int(vermelha.any(axis=0).sum())
        return colunas_marcadas >= max(5, int(w * 0.22))

    def marcada(self, caixa: tuple[int, int, int, int]) -> bool:
        """Fundo colorido atrás do texto (marca-texto ciano, amarelo…)."""
        x, y, w, h = caixa
        area = self.recorte(x, y, w, h)
        if area.size == 0:
            return False

        claro = area.min(axis=-1) >= LIMITE_TINTA
        if claro.sum() < 20:
            return False

        fundo = area[claro]
        saturacao = fundo.max(axis=-1) - fundo.min(axis=-1)
        return bool((saturacao > SATURACAO_MARCA).mean() > 0.5)


# ---------------------------------------------------------------- leitura


class Palavra:
    __slots__ = ("texto", "caixa", "vermelha", "sublinhada", "marcada")

    def __init__(self, texto: str, caixa: tuple[int, int, int, int], tela: Tela) -> None:
        self.texto = texto
        self.caixa = caixa
        self.vermelha = tela.fracao_vermelha(caixa) > 0.55
        self.sublinhada = tela.sublinhada(caixa)
        self.marcada = tela.marcada(caixa)


class Linha:
    def __init__(self, palavras: list[Palavra]) -> None:
        self.palavras = palavras

    @property
    def texto(self) -> str:
        return " ".join(p.texto for p in self.palavras)

    @property
    def vermelha(self) -> bool:
        """
        A linha inteira em vermelho — o gabarito.

        Medida por linha, e não por palavra, de propósito: uma alternativa
        revelada tem todos os glifos vermelhos, enquanto um traço de caneta
        atinge no máximo uma ou duas palavras.
        """
        candidatas = [p for p in self.palavras if len(p.texto) >= 2]
        if len(candidatas) < 2:
            return False
        return sum(p.vermelha for p in candidatas) / len(candidatas) > 0.6

    @property
    def topo(self) -> int:
        return min(p.caixa[1] for p in self.palavras)


def com_marcas(palavras: list[Palavra]) -> str:
    """Remonta o texto embutindo `__sublinhado__` e `==marcado==`."""
    partes: list[str] = []
    grupo: list[str] = []
    marca_atual: str | None = None

    def fechar() -> None:
        nonlocal grupo, marca_atual
        if not grupo:
            return
        miolo = " ".join(grupo)
        partes.append(f"{marca_atual}{miolo}{marca_atual}" if marca_atual else miolo)
        grupo, marca_atual = [], None

    for p in palavras:
        marca = "==" if p.marcada else ("__" if p.sublinhada else None)
        if marca != marca_atual:
            fechar()
            marca_atual = marca
        grupo.append(p.texto)

    fechar()
    return " ".join(partes)


def palavra_util(texto: str) -> bool:
    nu = sem_acento(texto).strip(".,;:!?_)(")
    # O travessão fica: em "artigo – preposição – pronome" ele é o conteúdo da
    # alternativa, não ruído. Só a barra vertical é sobra de ícone.
    if not nu or nu in {"|", "_"}:
        return False
    if MARCA_DO_CURSO.match(nu):
        return False
    # Letra solta é resto de ícone. O teste é no token cru: "B)" tem dois
    # caracteres e é marcador de alternativa, enquanto o lixo do logo vem
    # mesmo sozinho. Medir depois de tirar o ")" apagaria metade das
    # alternativas — sobrariam só "A)" e "E)", que são monossílabos válidos.
    if len(texto.strip()) == 1 and nu.isalpha() and nu.lower() not in SOZINHAS_VALIDAS:
        return False
    return True


def ler_palavras(tela: Tela, modo: str) -> list[Linha]:
    dados = pytesseract.image_to_data(
        tela.para_ocr(), lang=IDIOMA, config=modo, output_type=Output.DICT
    )

    agrupadas: dict[tuple[int, int, int], list[Palavra]] = {}

    for i, texto in enumerate(dados["text"]):
        texto = texto.strip()
        if not texto:
            continue
        try:
            confianca = float(dados["conf"][i])
        except (TypeError, ValueError):
            continue
        if confianca < CONFIANCA_MINIMA:
            continue

        caixa = (dados["left"][i], dados["top"][i], dados["width"][i], dados["height"][i])
        if caixa[2] <= 0 or caixa[3] <= 0:
            continue

        if not palavra_util(texto):
            continue

        chave = (dados["block_num"][i], dados["par_num"][i], dados["line_num"][i])
        agrupadas.setdefault(chave, []).append(Palavra(texto, caixa, tela))

    linhas = [Linha(p) for p in agrupadas.values() if p]
    linhas.sort(key=lambda l: l.topo)
    return [l for l in linhas if not RODAPE.search(sem_acento(l.texto).strip())]


# ---------------------------------------------------------------- cabeçalho


# O OCR troca dígito por símbolo parecido no ano do cabeçalho: "202]" por
# "2021". Só aplicamos em token de quatro caracteres que já é quase todo
# dígito, para não estragar texto de verdade.
CONFUSOES = str.maketrans({"]": "1", "|": "1", "l": "1", "I": "1", "O": "0", "S": "5"})


def consertar_ano(texto: str) -> str:
    def trocar(achado: re.Match[str]) -> str:
        token = achado.group(0)
        if sum(c.isdigit() for c in token) < 3:
            return token
        corrigido = token.translate(CONFUSOES)
        return corrigido if re.fullmatch(r"(19|20)\d{2}", corrigido) else token

    # Sem \b: o token termina em "]", que não é caractere de palavra, e aí
    # não existe fronteira para ancorar.
    return re.sub(r"(?<![\w\]|])[\w\]|]{4}(?![\w\]|])", trocar, texto)


def parse_cabecalho(bruto: str) -> dict[str, Any]:
    saida: dict[str, Any] = {"banca": None, "ano": None, "orgao": None, "prova": None}

    # "2.FCC - 2019 - ..." — o número é a ordem na aula, não faz parte do órgão.
    texto = consertar_ano(re.sub(r"^\s*\d+\s*[.)]\s*", "", bruto).strip())
    if not texto:
        return saida

    anos = re.findall(r"\b(19|20)\d{2}\b", texto)
    if anos:
        achado = re.search(r"\b((?:19|20)\d{2})\b", texto)
        if achado:
            saida["ano"] = int(achado.group(1))
            texto = (texto[: achado.start()] + " " + texto[achado.end() :]).strip()

    # "SEFAZ ES / 2021" põe o órgão à esquerda, mas "Guarda Port. / DOCAS-BA"
    # põe o cargo. Com o ano já retirado, uma barra sobrando quase sempre
    # separa cargo de órgão — e a sigla de UF no fim confirma qual é qual.
    if "/" in texto and " - " not in texto:
        esquerda, _, direita = (p.strip() for p in texto.partition("/"))
        if esquerda and direita:
            saida["orgao"] = direita
            saida["prova"] = esquerda
            return saida

    partes = [p.strip(" -–/") for p in re.split(r"\s+[-–]\s+|\s*/\s*", texto)]
    partes = [p for p in partes if p]

    if partes and partes[0].upper() in BANCAS:
        saida["banca"] = partes.pop(0).upper()

    if partes:
        saida["orgao"] = partes.pop(0)
    if partes:
        saida["prova"] = " - ".join(partes)

    return saida


def separar_cabecalho(linhas: list[Linha]) -> tuple[str, list[Linha]]:
    """O cabeçalho é a primeira linha, mais a seguinte se ela ficou pendurada."""
    if not linhas:
        return "", []

    primeira = linhas[0].texto
    pista = bool(
        re.search(r"\b(19|20)\d{2}\b", primeira) or "/" in primeira or " - " in primeira
    )
    if not pista or len(primeira) > 140:
        return "", linhas

    usadas = 1
    # "…- Analista de Tecnologia da" + "Informação - Suporte de DBA" é uma
    # linha só que o slide quebrou em duas.
    if len(linhas) > 1 and PENDURADO.search(primeira) and len(linhas[1].texto) < 90:
        primeira = f"{primeira} {linhas[1].texto}"
        usadas = 2

    return primeira, linhas[usadas:]


# ---------------------------------------------------------------- montagem


def montar(linhas: list[Linha], tela: Tela) -> dict[str, Any]:
    frame = frame_vazio()

    cabecalho, corpo = separar_cabecalho(linhas)
    if cabecalho:
        frame.update(parse_cabecalho(cabecalho))

    alternativas: dict[str, str] = {}
    gabarito: str | None = None
    corpo_enunciado: list[Linha] = []
    comecou_alternativas = False

    for linha in corpo:
        achado = ALTERNATIVA.match(linha.texto)
        if achado:
            comecou_alternativas = True
            letra = achado.group(1).upper()
            alternativas[letra] = achado.group(2).strip()
            if linha.vermelha and gabarito is None:
                gabarito = letra
            continue

        # Linha solta depois das alternativas costuma ser rodapé do slide.
        if not comecou_alternativas:
            corpo_enunciado.append(linha)

    if len(alternativas) < 2:
        return frame_vazio("Não há questão legível neste print.")

    enunciado = " ".join(com_marcas(l.palavras) for l in corpo_enunciado).strip()
    if not enunciado:
        return frame_vazio("Encontrei alternativas, mas nenhum enunciado.")

    observacoes: list[str] = []

    # Contar alternativas não diz nada sobre corte: existe questão de banca com
    # três, e tratar isso como defeito marcava questão inteira como quebrada.
    #
    # O corte de verdade acontece quando o slide está embutido no vídeo, com a
    # cena em volta: aí o enquadramento come o pé do slide. O sinal é o texto
    # ocupar só um pedaço da largura do quadro.
    caixas = [p.caixa for l in linhas for p in l.palavras]
    cortada = False
    if caixas:
        largura_do_texto = max(x + w for x, _, w, _ in caixas) - min(
            x for x, _, _, _ in caixas
        )
        cortada = largura_do_texto < tela.largura * 0.62

    if cortada:
        observacoes.append(
            "O slide está dentro do vídeo: confira no print se falta alternativa no pé."
        )

    if gabarito:
        frame["gabarito"] = gabarito
        frame["gabarito_evidencia"] = f"alternativa {gabarito} escrita em vermelho no slide"

    frame["tipo"] = "questao"
    frame["motivo_ignorar"] = None
    frame["enunciado"] = enunciado
    frame["alternativas"] = alternativas
    frame["cortada"] = cortada
    frame["observacao"] = " · ".join(observacoes) or None
    return frame


def ler_print(dados: bytes) -> dict[str, Any]:
    imagem = Image.open(io.BytesIO(dados))
    imagem.load()
    tela = Tela(imagem)

    melhor: list[Linha] = []
    melhor_nota = -1

    for modo in MODOS:
        linhas = ler_palavras(tela, modo)
        nota = sum(1 for l in linhas if ALTERNATIVA.match(l.texto))
        if nota > melhor_nota:
            melhor, melhor_nota = linhas, nota
        # Cinco alternativas é o teto usual: não vale tentar o outro modo.
        if melhor_nota >= 5:
            break

    if not melhor:
        return frame_vazio("Nenhum texto legível neste print.")

    return montar(melhor, tela)


# ---------------------------------------------------------------- entrada


def processar(pedido: dict[str, Any]) -> dict[str, Any]:
    nome = pedido.get("nome") or "print"
    try:
        dados = base64.b64decode(pedido["base64"])
        return {"nome": nome, "frame": ler_print(dados)}
    except Exception as erro:  # a falha de um print não pode derrubar o lote
        return {"nome": nome, "erro": f"{type(erro).__name__}: {erro}"}


def main() -> None:
    pedidos = [json.loads(linha) for linha in sys.stdin if linha.strip()]
    if not pedidos:
        return

    with ThreadPoolExecutor(max_workers=LEITURAS_PARALELAS) as pool:
        for resultado in pool.map(processar, pedidos):
            sys.stdout.write(json.dumps(resultado, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
