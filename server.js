const http = require('http');
const url = require('url');
const youtubedl = require('youtube-dl-exec');
const { Readable } = require('stream');
const path = require('path');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const videoId = parsed.query.v;

    res.setHeader('Access-Control-Allow-Origin', '*');

    if (parsed.pathname === '/ping') {
        res.writeHead(200); return res.end(JSON.stringify({ status: 'ok' }));
    }
    
    if (parsed.pathname === '/play' && videoId) {
        console.log(`[Play] Hackeando a YouTube para: ${videoId}`);
        
        // Usamos el archivo con el nombre exacto que te dio la extensión
        youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
            dumpSingleJson: true, 
            noWarnings: true, 
            format: 'bestaudio',
            extractorArgs: 'youtube:player_client=android',
            cookies: path.join(__dirname, 'www.youtube.com_cookies.txt')
        }).then(async output => {
            if (!output.url) return res.end('Error: No URL');
            
            try {
                const proxyFetch = await fetch(output.url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36' }
                });
                
                res.writeHead(proxyFetch.status, {
                    'Content-Type': proxyFetch.headers.get('content-type') || 'audio/webm',
                    'Content-Length': proxyFetch.headers.get('content-length') || ''
                });
                
                Readable.fromWeb(proxyFetch.body).pipe(res);
                console.log(`[Play] Transmitiendo audio al 100%: ${videoId}`);
                
                req.on('close', () => {
                    console.log(`[Play] MTA Desconectado de: ${videoId}`);
                });
            } catch (err) {
                console.log(`[Error Proxy] ${err.message}`);
                res.end();
            }
        }).catch(err => {
            console.log(`[Error YT-DLP] ${err.message}`);
            res.end();
        });
        return;
    }
    res.writeHead(400); res.end('Use /play?v=VIDEO_ID');
});

server.listen(PORT, () => console.log(`[HVS Radio] Helper indomable en puerto ${PORT}`));
