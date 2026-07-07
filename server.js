/**
 * FFS Radio - Helper Server (yt-dlp edition)
 * Coloque yt-dlp.exe nesta mesma pasta.
 * Opcional: cookies.txt exportado do YouTube
 *
 * Rodar: node server.js
 */

const http  = require('http');
const url   = require('url');
const fs    = require('fs');
const path  = require('path');
const { execFile } = require('child_process');

const PORT         = process.env.SERVER_PORT || 26112; // Pterodactyl usa SERVER_PORT
const HOST         = '0.0.0.0';
const CACHE        = new Map();
const CACHE_MARGIN = 300;

const YTDLP = path.join(__dirname, 'yt-dlp.exe');

if (!fs.existsSync(YTDLP)) {
    console.error('[FFS Radio Helper] ERRO: yt-dlp.exe não encontrado!');
    console.error('[FFS Radio Helper] Baixe em: https://github.com/yt-dlp/yt-dlp/releases/latest');
    process.exit(1);
}
console.log('[FFS Radio Helper] yt-dlp.exe encontrado!');

const COOKIES = path.join(__dirname, 'cookies.txt');
const hasCookies = fs.existsSync(COOKIES);
console.log(`[FFS Radio Helper] Cookies: ${hasCookies ? 'SIM ✓' : 'NÃO'}`);

// ─── Resolver via yt-dlp ──────────────────────────────────
function resolveStreamUrl(videoId) {
    return new Promise((resolve, reject) => {
        const cached = CACHE.get(videoId);
        if (cached && cached.expires > Date.now()/1000 + CACHE_MARGIN) {
            console.log(`[Cache HIT] ${videoId}`);
            return resolve(cached.url);
        }

        console.log(`[Resolvendo] ${videoId}`);

        const args = [
            '--no-warnings',
            '--no-playlist',
            '--js-runtimes', 'node',
            // IMPORTANTE: MTA:SA (BASS) reproduce MP4/AAC (m4a) de forma confiable,
            // pero tiene soporte poco confiable para WebM/Opus (que es lo que
            // "bestaudio/best" suele elegir en YouTube hoy en día). Forzamos m4a
            // primero y solo caemos a otro formato si de verdad no existe m4a.
            '-f', 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/best[ext=mp4]/bestaudio/best',
            '--get-url',
        ];

        if (hasCookies) args.push('--cookies', COOKIES);

        args.push(`https://www.youtube.com/watch?v=${videoId}`);

        execFile(YTDLP, args, { timeout: 30000 }, (err, stdout, stderr) => {
            if (err) {
                return reject(new Error(stderr.trim() || err.message));
            }

            const streamUrl = stdout.trim().split('\n')[0];
            if (!streamUrl || !streamUrl.startsWith('http')) {
                return reject(new Error('URL inválida retornada pelo yt-dlp'));
            }

            const expireMatch = streamUrl.match(/expire=(\d+)/);
            const expires = expireMatch ? parseInt(expireMatch[1]) : (Date.now()/1000 + 3600);

            const mimeMatch = streamUrl.match(/mime=([^&]+)/);
            console.log(`[Resolvido] ${videoId} | formato=${mimeMatch ? decodeURIComponent(mimeMatch[1]) : 'desconhecido'} | expire=${new Date(expires*1000).toISOString()}`);

            CACHE.set(videoId, { url: streamUrl, expires });
            resolve(streamUrl);
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
