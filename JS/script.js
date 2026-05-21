// ============================================================
//   PLATAFORMA HBP — script.js  v2.0
//   Supabase Auth + Realtime + Alerta Sonoro
//   Desenvolvido por: PAULO JOSÉ ALMEIDA FERNANDES JÚNIOR
// ============================================================

// ============================================================
// 1. INICIALIZAÇÃO DO SUPABASE
// ============================================================

const SUPABASE_URL = 'https://yzhuzcuvyveubovwkzkm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_79IJRXEk4J-JwxTXbPDgqw_YTsBssED';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// 2. UTILITÁRIOS
// ============================================================

// Capitaliza a primeira letra de uma string
function capitalizar(texto) {
    if (!texto) return '';
    return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Formata o timestamp do banco para "DD/MM às HH:MM" no fuso de Brasília
function formatarData(timestampISO) {
    if (!timestampISO) return '—';
    const data = new Date(timestampISO);
    return data.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day:    '2-digit',
        month:  '2-digit',
        hour:   '2-digit',
        minute: '2-digit'
    }).replace(',', ' às');
}

// Toca um bip de alerta usando a Web Audio API (sem arquivos externos)
function tocarBip() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.6);
    } catch (e) {
        console.warn('Não foi possível tocar o bip:', e);
    }
}

// ============================================================
// 3. ROTEADOR DE PÁGINAS
//    Detecta qual página está ativa pelos elementos do DOM
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('form-chamado'))       iniciarPaginaAbertura();
    if (document.getElementById('form-login'))         iniciarPaginaLogin();
    if (document.getElementById('corpo-tabela-tecnico')) iniciarPaginaTecnico();
    if (document.getElementById('corpo-tabela-status')) iniciarPaginaStatus();
});

// ============================================================
// 4. PÁGINA DE ABERTURA — index.html
//    Salva o chamado, exibe o protocolo (ID) e limpa o form
// ============================================================

function iniciarPaginaAbertura() {
    const form = document.getElementById('form-chamado');
    if (!form) return;

    form.addEventListener('submit', async (evento) => {
        evento.preventDefault();

        const setor      = document.getElementById('setor').value;
        const categoria  = document.getElementById('categoria').value;
        const prioridade = document.querySelector('input[name="prioridade"]:checked').value;
        const descricao  = document.getElementById('descricao').value.trim();

        if (!setor || !categoria || !prioridade || !descricao) {
            alert('⚠️ Preencha todos os campos antes de abrir o chamado.');
            return;
        }

        const btnEnviar = form.querySelector('.btn-enviar');
        btnEnviar.disabled = true;
        btnEnviar.textContent = 'Enviando...';

        try {
            const { data, error } = await db
                .from('chamados')
                .insert([{ setor, categoria, prioridade, descricao, status: 'Pendente' }])
                .select('id')
                .single();

            if (error) throw error;

            // Exibe o protocolo com o ID gerado pelo banco
            alert(
                `✅ Chamado #${data.id} aberto com sucesso!\n\n` +
                `⚠️ Guarde este número: #${data.id}\n` +
                `Ele é seu protocolo de atendimento. Caso o sistema seja fechado acidentalmente, ` +
                `informe este número ao técnico para localizar seu chamado.`
            );

            form.reset();

        } catch (erro) {
            console.error('Erro ao salvar chamado:', erro);
            alert(`❌ Erro ao abrir o chamado:\n${erro.message || 'Verifique sua conexão e tente novamente.'}`);
        } finally {
            btnEnviar.disabled = false;
            btnEnviar.textContent = 'ABRIR CHAMADO';
        }
    });
}

// ============================================================
// 5. PÁGINA DE LOGIN — login.html
//    Autentica o técnico e redireciona para o painel
// ============================================================

function iniciarPaginaLogin() {
    const form = document.getElementById('form-login');
    if (!form) return;

    form.addEventListener('submit', async (evento) => {
        evento.preventDefault();

        const email = document.getElementById('email').value.trim();
        const senha = document.getElementById('senha').value;

        const btnLogin = form.querySelector('.btn-enviar');
        btnLogin.disabled = true;
        btnLogin.textContent = 'Entrando...';

        try {
            const { data, error } = await db.auth.signInWithPassword({ email, password: senha });

            if (error) throw error;

            // Login bem-sucedido — redireciona para o painel
            window.location.href = 'painel.html';

        } catch (erro) {
            console.error('Erro no login:', erro);
            alert(`❌ Falha no login:\n${erro.message || 'E-mail ou senha incorretos.'}`);
            btnLogin.disabled = false;
            btnLogin.textContent = 'ENTRAR';
        }
    });
}

// ============================================================
// 6. PÁGINA DO TÉCNICO — painel.html
//    Protegida por sessão, com Realtime e alerta sonoro
// ============================================================

async function iniciarPaginaTecnico() {
    const corpoTabela = document.getElementById('corpo-tabela-tecnico');
    if (!corpoTabela) return;

    // PROTEÇÃO: verifica se há sessão ativa antes de mostrar qualquer dado
    try {
        const { data: { session } } = await db.auth.getSession();
        if (!session) {
            alert('🔒 Acesso restrito. Faça login para continuar.');
            window.location.href = 'login.html';
            return;
        }
    } catch (erro) {
        console.error('Erro ao verificar sessão:', erro);
        window.location.href = 'login.html';
        return;
    }

    // Primeira carga da tabela
    await carregarChamadosTecnico();

    // Conta quantos chamados existem antes de ativar o Realtime,
    // para não disparar o bip nos já existentes
    let totalAnterior = corpoTabela.querySelectorAll('tr').length;

    // Realtime: re-carrega a tabela e toca bip em novos chamados
    db.channel('chamados-painel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chamados' }, async (payload) => {
            await carregarChamadosTecnico();

            // Toca o bip apenas quando um chamado novo for inserido
            if (payload.eventType === 'INSERT') {
                tocarBip();
            }
        })
        .subscribe();
}

async function carregarChamadosTecnico() {
    const corpoTabela = document.getElementById('corpo-tabela-tecnico');
    if (!corpoTabela) return;

    corpoTabela.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:16px;">Carregando chamados...</td></tr>';

    try {
        const { data: chamados, error } = await db
            .from('chamados')
            .select('*')
            .neq('status', 'Concluído')
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!chamados || chamados.length === 0) {
            corpoTabela.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#28a745;padding:20px;">✅ Nenhum chamado pendente no momento.</td></tr>';
            return;
        }

        corpoTabela.innerHTML = '';

        chamados.forEach(chamado => {
            const linha = document.createElement('tr');

            const classePrioridade = chamado.prioridade === 'alta' ? 'alta' :
                                     chamado.prioridade === 'media' ? 'media' : 'baixa';

            const classeStatus = chamado.status === 'Em Andamento' ? 'andamento' : 'pendente';

            // Botão "Atender" só aparece se ainda estiver Pendente
            // Botão "Concluir" aparece para Pendente e Em Andamento (com confirm)
            const botoes = `
                <div class="acoes">
                    ${chamado.status === 'Pendente' ? `
                        <button class="btn-atender" onclick="atualizarStatus(${chamado.id}, 'Em Andamento')">
                            Atender
                        </button>
                    ` : ''}
                    <button class="btn-concluir" onclick="confirmarConclusao(${chamado.id})">
                        Concluir
                    </button>
                </div>
            `;

            linha.innerHTML = `
                <td>#${chamado.id}</td>
                <td>${formatarData(chamado.created_at)}</td>
                <td>${chamado.setor}</td>
                
                <!-- LINHA CORRIGIDA: Texto cortado com '...' e balão ao passar o mouse -->
                <td class="coluna-descricao" title="${chamado.descricao || 'Sem descrição'}" style="max-width:220px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:13px; cursor:pointer;">
                    ${chamado.descricao || '—'}
                </td>
                
                <td><span class="badge ${classePrioridade}">${capitalizar(chamado.prioridade)}</span></td>
                <td><span class="flag ${classeStatus}">${chamado.status}</span></td>
                <td>${botoes}</td>
            `;

            corpoTabela.appendChild(linha);
        });

    } catch (erro) {
        console.error('Erro ao carregar chamados (painel):', erro);
        corpoTabela.innerHTML = `<tr><td colspan="7" style="text-align:center;color:red;padding:16px;">❌ Erro ao carregar chamados: ${erro.message}</td></tr>`;
    }
}

// Exibe confirm antes de concluir — só executa se o técnico confirmar
async function confirmarConclusao(id) {
    const confirmado = confirm(`⚠️ Deseja realmente finalizar o Chamado #${id}?\n\nEssa ação irá remover o chamado da fila ativa.`);
    if (!confirmado) return;
    await atualizarStatus(id, 'Concluído');
}

// Atualiza o status de qualquer chamado no banco
async function atualizarStatus(id, novoStatus) {
    try {
        const { error } = await db
            .from('chamados')
            .update({ status: novoStatus })
            .eq('id', id);

        if (error) throw error;

        // O Realtime vai recarregar a tabela automaticamente.
        // Mas fazemos uma carga manual como fallback imediato:
        await carregarChamadosTecnico();

    } catch (erro) {
        console.error(`Erro ao atualizar chamado #${id}:`, erro);
        alert(`❌ Não foi possível atualizar o chamado:\n${erro.message}`);
    }
}

// ============================================================
// 7. PÁGINA DE STATUS — status.html
//    Somente leitura, Realtime, com data formatada
// ============================================================

async function iniciarPaginaStatus() {
    const corpoTabela = document.getElementById('corpo-tabela-status');
    if (!corpoTabela) return;

    await carregarChamadosStatus();

    db.channel('chamados-status')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chamados' }, () => {
            carregarChamadosStatus();
        })
        .subscribe();
}

async function carregarChamadosStatus() {
    const corpoTabela = document.getElementById('corpo-tabela-status');
    if (!corpoTabela) return;

    corpoTabela.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:16px;">Carregando...</td></tr>';

    try {
        const { data: chamados, error } = await db
            .from('chamados')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!chamados || chamados.length === 0) {
            corpoTabela.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:20px;">Nenhum chamado registrado ainda.</td></tr>';
            return;
        }

        corpoTabela.innerHTML = '';

        chamados.forEach(chamado => {
            const linha = document.createElement('tr');

            const classePrioridade = chamado.prioridade === 'alta' ? 'alta' :
                                     chamado.prioridade === 'media' ? 'media' : 'baixa';

            const classeStatus = chamado.status === 'Em Andamento' ? 'andamento' :
                                  chamado.status === 'Concluído'   ? 'concluido' : 'pendente';

            linha.innerHTML = `
                <td>${chamado.setor}</td>
                <td>${formatarData(chamado.created_at)}</td>
                <td><span class="badge ${classePrioridade}">${capitalizar(chamado.prioridade)}</span></td>
                <td><span class="flag ${classeStatus}">${chamado.status}</span></td>
            `;

            corpoTabela.appendChild(linha);
        });

    } catch (erro) {
        console.error('Erro ao carregar status:', erro);
        corpoTabela.innerHTML = `<tr><td colspan="4" style="text-align:center;color:red;padding:16px;">❌ Erro ao carregar dados: ${erro.message}</td></tr>`;
    }
}
