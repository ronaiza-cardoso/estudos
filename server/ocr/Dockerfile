# Leitura dos prints: OCR em português + análise de cor.
#
# Vive num container por dois motivos. O tesseract e os dados de português são
# dependências de sistema que ninguém quer instalar na máquina para usar um app
# de estudos. E, isolado, dá para rodar com --network none: nenhum print sai
# daqui, o que é o ponto de não usar uma API.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-por \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY ocr_prints.py ./

# -u: sem buffer. O servidor lê o resultado de cada print conforme sai, e é
# assim que as questões aparecem uma a uma na tela.
ENTRYPOINT ["python", "-u", "ocr_prints.py"]
