/**
 * FFS Radio - Helper Server (yt-dlp edition, via youtube-dl-exec)
 * Não requer binário manual: youtube-dl-exec descarga o yt-dlp
 * correto para o SO automaticamente durante "npm install"/"yarn install".
 * Opcional: cookies.txt exportado do YouTube
 *
 * Rodar: node server.js
 */

const http  = require('http');
const url   = require('url');
const fs    = require('fs');
const path  = require('path');

const PORT         = process.env.SERVER_PORT || 26112; // Pterodactyl usa SERVER_PORT
const HOST         = '0.0.0.0';
const CACHE        = new Map();
const CACHE_MARGIN = 300;

// youtube-dl-exec baixa e gerencia o binário correto do yt-dlp para o SO onde
// o processo está rodando (Windows .exe localmente, binário Linux no Render/Pterodactyl).
// Isso substitui o antigo caminho fixo para "yt-dlp.exe", que só funcionava no Windows.
const youtubedl = require('youtube-dl-exec');

// Cookies opcionais: procura tanto no diretório do projeto (uso local) quanto
// no diretório de "Secret Files" do Render (/etc/secrets), que é la forma
// recomendada de subir un archivo sensible sin comprometerlo en el repo público.
const COOKIE_CANDIDATES = [
    process.env.YT_COOKIES_PATH,
    '/etc/secrets/cookies.txt',
    path.join(__dirname, 'cookies.txt'),
].filter(Boolean);
const COOKIES = COOKIE_CANDIDATES.find((p) => fs.existsSync(p)) || null;
const hasCookies = !!COOKIES;
console.log(`[FFS Radio Helper] Cookies: ${hasCookies ? 'SIM ✓ (' + COOKIES + ')' : 'NÃO'}`);

// Clientes de YouTube a intentar. Ahora que tenemos cookies, el cliente
// "web" por defecto ya pasa el chequeo anti-bot, así que lo priorizamos.
// Dejamos "android" solo como red de respaldo por si las cookies vencen,
// pero con un selector de formato mucho más permisivo (ese cliente no
// expone streams de audio-only en m4a, así que exigir m4a ahí siempre falla).
const ATTEMPTS = [
    { client: null,        format: 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/best[ext=mp4]/bestaudio/best' },
    { client: null,        format: 'best' },
    { client: 'android',   format: 'best' },
    { client: 'ios',       format: 'best' },
    { client: 'tv_simply', format: 'best' },
    { client: 'mweb',      format: 'best' },
];

// ─── Resolver via yt-dlp (youtube-dl-exec, cross-platform) ────────────────
function resolveStreamUrl(videoId) {
    return new Promise((resolve, reject) => {
        const cached = CACHE.get(videoId);
        if (cached && cached.expires > Date.now()/1000 + CACHE_MARGIN) {
            console.log(`[Cache HIT] ${videoId}`);
            return resolve(cached.url);
        }

        console.log(`[Resolvendo] ${videoId}`);

        const tryAttempt = (index, lastErr) => {
            if (index >= ATTEMPTS.length) {
                return reject(lastErr || new Error('Todas as tentativas falharam'));
            }
            const { client, format } = ATTEMPTS[index];

            const opts = {
                noWarnings: true,
                noPlaylist: true,
                jsRuntimes: 'node',
                format,
                getUrl: true,
            };
            if (client) opts.extractorArgs = `youtube:player_client=${client}`;
            if (hasCookies) opts.cookies = COOKIES;

            youtubedl(`https://www.youtube.com/watch?v=${videoId}`, opts, { timeout: 30000 })
                .then((output) => {
                    const streamUrl = String(output).trim().split('\n')[0];
                    if (!streamUrl || !streamUrl.startsWith('http')) {
                        return tryAttempt(index + 1, new Error('URL inválida retornada pelo yt-dlp'));
                    }

                    const expireMatch = streamUrl.match(/expire=(\d+)/);
                    const expires = expireMatch ? parseInt(expireMatch[1]) : (Date.now()/1000 + 3600);

                    const mimeMatch = streamUrl.match(/mime=([^&]+)/);
                    console.log(`[Resolvido] ${videoId} | client=${client || 'web(default)'} | formato=${mimeMatch ? decodeURIComponent(mimeMatch[1]) : 'desconhecido'} | expire=${new Date(expires*1000).toISOString()}`);

                    CACHE.set(videoId, { url: streamUrl, expires });
                    resolve(streamUrl);
                })
                .catch((err) => {
                    const msg = (err.stderr || err.message || String(err)).trim();
                    console.log(`[Aviso] tentativa ${index + 1} (client=${client || 'web(default)'}, format=${format}) falhou para ${videoId}: ${msg.split('\n')[0]}`);
                    tryAttempt(index + 1, new Error(msg));
                });
        };

        tryAttempt(0, null);
    });
}

// ─── HTTP Server ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    const parsed  = url.parse(req.url, true);
    const videoId = parsed.query.v;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (parsed.pathname === '/ping') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', cookies: hasCookies }));
        return;
    }

    if (parsed.pathname === '/play' && videoId) {
        try {
            const streamUrl = await resolveStreamUrl(videoId);
            const https = streamUrl.startsWith('https') ? require('https') : require('http');
            const options = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            };
            if (req.headers['range']) {
                options.headers['Range'] = req.headers['range'];
            }
            https.get(streamUrl, options, (proxyRes) => {
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(res);
            }).on('error', (err) => {
                console.error(`[ERRO PROXY] ${videoId}:`, err.message);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Proxy error' }));
            });
        } catch (err) {
            console.error(`[ERRO] ${videoId}: ${err.message}`);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    if (parsed.pathname !== '/stream' || !videoId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Use /stream?v=VIDEO_ID' }));
        return;
    }

    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'videoId inválido' }));
        return;
    }

    try {
        const streamUrl = await resolveStreamUrl(videoId);
        res.writeHead(200);
        res.end(JSON.stringify({ url: streamUrl }));
    } catch (err) {
        console.error(`[ERRO] ${videoId}: ${err.message}`);
        const status = err.message.includes('429') ? 429
                     : err.message.includes('410') ? 410
                     : 500;
        res.writeHead(status);
        res.end(JSON.stringify({ error: err.message }));
    }
});

server.listen(PORT, HOST, () => {
    console.log(`[FFS Radio Helper] Rodando em http://${HOST}:${PORT}`);
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`[ERRO] Porta ${PORT} já em uso.`);
    } else {
        console.error('[ERRO] Servidor:', e.message);
    }
    process.exit(1);
});
