const http = require('http');
const url = require('url');
const ytdl = require('@distube/ytdl-core');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const videoId = parsed.query.v;

    res.setHeader('Access-Control-Allow-Origin', '*');

    if (parsed.pathname === '/ping') {
        res.writeHead(200); return res.end(JSON.stringify({ status: 'ok' }));
    }
    
    if (parsed.pathname === '/play' && videoId) {
        console.log(`[Play] Iniciando proxy para: ${videoId}`);
        
        try {
            // Usamos ytdl-core para obtener el stream limpio
            const stream = ytdl(`https://www.youtube.com/watch?v=${videoId}`, { 
                filter: 'audioonly', 
                quality: 'highestaudio' 
            });
            
            // Cuando obtenemos la info, le enviamos las cabeceras exactas al GTA
            stream.on('info', (info, format) => {
                res.writeHead(200, {
                    'Content-Type': format.mimeType,
                    'Content-Length': format.contentLength || '',
                    'Accept-Ranges': 'bytes'
                });
            });
            
            // Enviamos la música al cliente
            stream.pipe(res);
            
            stream.on('error', (err) => console.log(`[Aviso] ytdl: ${err.message}`));
            
            req.on('close', () => {
                console.log(`[Play] MTA desconectado / Cancion finalizada: ${videoId}`);
                stream.destroy();
            });
        } catch(err) {
            console.log(`[Error] ${err.message}`);
            res.end();
        }
        return;
    }
    res.writeHead(400); res.end('Use /play?v=VIDEO_ID');
});

server.listen(PORT, () => console.log(`[HVS Radio] Helper en puerto ${PORT}`));
