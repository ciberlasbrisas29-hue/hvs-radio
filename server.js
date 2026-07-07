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

const COOKIES = path.join(__dirname, 'cookies.txt');
const hasCookies = fs.existsSync(COOKIES);
console.log(`[FFS Radio Helper] Cookies: ${hasCookies ? 'SIM ✓' : 'NÃO'}`);

// ─── Resolver via yt-dlp (youtube-dl-exec, cross-platform) ────────────────
function resolveStreamUrl(videoId) {
    return new Promise((resolve, reject) => {
        const cached = CACHE.get(videoId);
        if (cached && cached.expires > Date.now()/1000 + CACHE_MARGIN) {
            console.log(`[Cache HIT] ${videoId}`);
            return resolve(cached.url);
        }

        console.log(`[Resolvendo] ${videoId}`);

        const opts = {
            noWarnings: true,
            noPlaylist: true,
            // IMPORTANTE: MTA:SA (BASS) reproduce MP4/AAC (m4a) de forma confiable,
            // pero tiene soporte poco confiable para WebM/Opus (lo que "bestaudio"
            // suele elegir hoy en día en YouTube). Forzamos m4a primero.
            format: 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/best[ext=mp4]/bestaudio/best',
            getUrl: true,
        };
        if (hasCookies) opts.cookies = COOKIES;

        youtubedl(`https://www.youtube.com/watch?v=${videoId}`, opts, { timeout: 30000 })
            .then((output) => {
                const streamUrl = String(output).trim().split('\n')[0];
                if (!streamUrl || !streamUrl.startsWith('http')) {
                    return reject(new Error('URL inválida retornada pelo yt-dlp'));
                }

                const expireMatch = streamUrl.match(/expire=(\d+)/);
                const expires = expireMatch ? parseInt(expireMatch[1]) : (Date.now()/1000 + 3600);

                const mimeMatch = streamUrl.match(/mime=([^&]+)/);
                console.log(`[Resolvido] ${videoId} | formato=${mimeMatch ? decodeURIComponent(mimeMatch[1]) : 'desconhecido'} | expire=${new Date(expires*1000).toISOString()}`);

                CACHE.set(videoId, { url: streamUrl, expires });
                resolve(streamUrl);
            })
            .catch((err) => {
                reject(new Error((err.stderr || err.message || String(err)).trim()));
            });
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
