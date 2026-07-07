const http = require('http');
const url = require('url');
const youtubedl = require('youtube-dl-exec');

const PORT = process.env.PORT || 3000;
const CACHE = new Map();

function resolveStreamUrl(videoId) {
    return new Promise((resolve, reject) => {
        const cached = CACHE.get(videoId);
        if (cached && cached.expires > Date.now()/1000 + 300) return resolve(cached.url);
        
        youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
            dumpSingleJson: true, noWarnings: true, format: 'bestaudio/best',
        }).then(output => {
            if (!output.url) return reject(new Error("URL de audio vacía"));
            CACHE.set(videoId, { url: output.url, expires: (Date.now()/1000 + 3600) });
            resolve(output.url);
        }).catch(err => reject(err));
    });
}

const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    const videoId = parsed.query.v;
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (parsed.pathname === '/ping') {
        res.writeHead(200); return res.end(JSON.stringify({ status: 'ok' }));
    }
    if (parsed.pathname === '/play' && videoId) {
        try {
            const streamUrl = await resolveStreamUrl(videoId);
            const reqHttps = streamUrl.startsWith('https') ? require('https') : require('http');
            const options = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } };
            if (req.headers['range']) options.headers['Range'] = req.headers['range'];

            reqHttps.get(streamUrl, options, (proxyRes) => {
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(res);
            }).on('error', () => { res.writeHead(500); res.end('Proxy Error'); });
        } catch (err) { res.writeHead(500); res.end(err.message); }
        return;
    }
    res.writeHead(400); res.end('Use /play?v=VIDEO_ID');
});

server.listen(PORT, () => console.log(`[HVS Radio] Helper en puerto ${PORT}`));
