const http = require('http');
const url = require('url');
const youtubedl = require('youtube-dl-exec');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const videoId = parsed.query.v;

    res.setHeader('Access-Control-Allow-Origin', '*');

    if (parsed.pathname === '/ping') {
        res.writeHead(200); return res.end(JSON.stringify({ status: 'ok' }));
    }
    
    if (parsed.pathname === '/play' && videoId) {
        console.log(`[Play] Reproduciendo: ${videoId}`);
        res.writeHead(200, { 'Content-Type': 'audio/webm' });
        
        const subprocess = youtubedl.exec(`https://www.youtube.com/watch?v=${videoId}`, {
            output: '-',
            format: 'bestaudio[ext=webm]/bestaudio',
            noWarnings: true
        });

        subprocess.stdout.pipe(res);
        
        // EVITAR CRASHEOS: Si se cancela la descarga o el MTA se desconecta, ignoramos el error
        subprocess.catch(err => {
            console.log(`[Aviso] Stream detenido o cancelado para ${videoId}`);
        });

        // Si el jugador apaga la radio, matamos el proceso para no gastar RAM
        req.on('close', () => {
            console.log(`[Play] Cliente MTA desconectado: ${videoId}`);
            subprocess.kill('SIGTERM');
        });
        return;
    }
    res.writeHead(400); res.end('Use /play?v=VIDEO_ID');
});

server.listen(PORT, () => console.log(`[HVS Radio] Helper en puerto ${PORT}`));
