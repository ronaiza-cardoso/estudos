/**
 * Testes do login. A parte de senha é pura e roda sempre; a parte de sessão
 * sobe um PGlite de verdade num diretório temporário, para exercitar também a
 * migration.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

// `db.ts` lê DATABASE_URL na carga do módulo: sem isto, quem tiver a variável
// exportada no shell rodaria os testes contra o Postgres do compose.
delete process.env.DATABASE_URL;

const dir = mkdtempSync(resolve(tmpdir(), 'estudos-auth-'));
process.env.ESTUDOS_DATA_DIR = dir;

const auth = await import('../src/auth.js');
const db = await import('../src/db.js');
const { agoraLocal } = await import('../src/util.js');

describe('senha', () => {
  it('confere a senha correta e recusa a errada', async () => {
    const hash = await auth.gerarHash('senha-secreta-1');
    expect(await auth.conferirSenha('senha-secreta-1', hash)).toBe(true);
    expect(await auth.conferirSenha('senha-secreta-2', hash)).toBe(false);
    expect(await auth.conferirSenha('', hash)).toBe(false);
  });

  it('usa salt novo a cada hash', async () => {
    const [a, b] = [await auth.gerarHash('mesma-senha'), await auth.gerarHash('mesma-senha')];
    expect(a).not.toBe(b);
    // Ainda assim os dois validam a mesma senha.
    expect(await auth.conferirSenha('mesma-senha', a)).toBe(true);
    expect(await auth.conferirSenha('mesma-senha', b)).toBe(true);
  });

  it('grava o custo junto do hash, para poder mudar depois', async () => {
    expect(await auth.gerarHash('qualquer-senha')).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
  });

  it('recusa hash malformado em vez de estourar', async () => {
    for (const lixo of ['', 'abc', 'scrypt$1$2$3', 'bcrypt$1$2$3$aa$bb', 'scrypt$1$2$3$$']) {
      expect(await auth.conferirSenha('qualquer', lixo)).toBe(false);
    }
  });

  it('exige senha de tamanho mínimo', () => {
    expect(auth.criticarSenha('curta')).toBeTruthy();
    expect(auth.criticarSenha('')).toBeTruthy();
    expect(auth.criticarSenha(undefined)).toBeTruthy();
    expect(auth.criticarSenha('a'.repeat(300))).toBeTruthy();
    expect(auth.criticarSenha('oito1234')).toBeNull();
  });
});

describe('loginAtivo', () => {
  const original = { ...process.env };
  afterAll(() => {
    process.env.ESTUDOS_LOGIN = original.ESTUDOS_LOGIN;
    delete process.env.DATABASE_URL;
  });

  it('fica desligado com banco embutido e ligado com Postgres', () => {
    delete process.env.ESTUDOS_LOGIN;
    delete process.env.DATABASE_URL;
    expect(auth.loginAtivo()).toBe(false);

    process.env.DATABASE_URL = 'postgres://u:p@db:5432/estudos';
    expect(auth.loginAtivo()).toBe(true);
    delete process.env.DATABASE_URL;
  });

  it('ESTUDOS_LOGIN tem a palavra final nos dois sentidos', () => {
    process.env.ESTUDOS_LOGIN = '1';
    expect(auth.loginAtivo()).toBe(true);

    process.env.ESTUDOS_LOGIN = '0';
    process.env.DATABASE_URL = 'postgres://u:p@db:5432/estudos';
    expect(auth.loginAtivo()).toBe(false);

    delete process.env.DATABASE_URL;
    delete process.env.ESTUDOS_LOGIN;
  });
});

describe('trava de força bruta', () => {
  it('bloqueia depois de tentativas demais e solta no acerto', () => {
    auth.zerarTravas();
    const ip = '10.0.0.1';

    for (let i = 0; i < 7; i++) auth.registrarFalha(ip);
    expect(auth.bloqueioRestante(ip)).toBe(0); // ainda dentro do limite

    auth.registrarFalha(ip);
    expect(auth.bloqueioRestante(ip)).toBeGreaterThan(0);

    // Outra origem não é afetada.
    expect(auth.bloqueioRestante('10.0.0.2')).toBe(0);

    auth.limparFalhas(ip);
    expect(auth.bloqueioRestante(ip)).toBe(0);
  });
});

describe('conta e sessão', () => {
  beforeAll(async () => {
    await db.abrirBanco();
    await db.migrar();
  }, 60_000);

  afterAll(async () => {
    await db.encerrarBanco();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a migration cria as tabelas de login', async () => {
    const tabelas = await db.q<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('usuarios', 'sessoes_login')`,
    );
    expect(tabelas.map((t) => t.table_name).sort()).toEqual(['sessoes_login', 'usuarios']);
  });

  it('cria a conta única e recusa uma segunda', async () => {
    expect(await auth.contaConfigurada()).toBe(false);

    const usuario = await auth.criarConta('ronaiza', 'senha-boa-123');
    expect(usuario.id).toBeGreaterThan(0);
    expect(await auth.contaConfigurada()).toBe(true);

    // É o que fecha /api/primeiro-acesso depois do cadastro.
    await expect(auth.criarConta('outra', 'senha-boa-456')).rejects.toThrow();
  });

  it('acha o usuário ignorando maiúsculas', async () => {
    expect((await auth.buscarPorLogin('RONAIZA'))?.login).toBe('ronaiza');
    expect(await auth.buscarPorLogin('ninguem')).toBeUndefined();
  });

  it('a sessão criada vale e o logout a invalida', async () => {
    const { id } = (await auth.buscarPorLogin('ronaiza'))!;
    const token = await auth.criarSessao(id);

    expect((await auth.usuarioDaSessao(token))?.login).toBe('ronaiza');
    expect(await auth.usuarioDaSessao('token-inventado')).toBeNull();
    expect(await auth.usuarioDaSessao(undefined)).toBeNull();

    await auth.encerrarSessao(token);
    expect(await auth.usuarioDaSessao(token)).toBeNull();
  });

  it('sessão vencida não autentica e a faxina a remove', async () => {
    const { id } = (await auth.buscarPorLogin('ronaiza'))!;
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);

    await db.exec(
      'INSERT INTO sessoes_login (token, usuario_id, criada_em, expira_em) VALUES ($1, $2, $3, $4)',
      ['token-vencido', id, agoraLocal(ontem), agoraLocal(ontem)],
    );

    expect(await auth.usuarioDaSessao('token-vencido')).toBeNull();
    expect(await auth.limparSessoesVencidas()).toBeGreaterThan(0);
  });

  it('trocar a senha invalida as outras sessões e mantém a atual', async () => {
    const { id } = (await auth.buscarPorLogin('ronaiza'))!;
    const atual = await auth.criarSessao(id);
    const outra = await auth.criarSessao(id);

    await auth.trocarSenha(id, 'senha-nova-789');
    await auth.encerrarSessoesDoUsuario(id, atual);

    expect(await auth.usuarioDaSessao(atual)).not.toBeNull();
    expect(await auth.usuarioDaSessao(outra)).toBeNull();

    const registro = (await auth.buscarPorLogin('ronaiza'))!;
    expect(await auth.conferirSenha('senha-nova-789', registro.senha_hash)).toBe(true);
    expect(await auth.conferirSenha('senha-boa-123', registro.senha_hash)).toBe(false);
  });
});
