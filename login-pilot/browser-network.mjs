import http from 'node:http';
import net from 'node:net';
import { lookup } from 'node:dns/promises';

/** Conservative globally-routable destinations only; deny metadata, local and transition ranges. */
export function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===100 && b>=64 && b<=127) ||
      (a===169 && b===254) || (a===172 && b>=16 && b<=31) ||
      (a===192 && (b===168 || b===0 || (b===88 && c===99))) ||
      (a===198 && (b===18 || b===19 || (b===51 && c===100))) || (a===203 && b===0 && c===113) || address==='168.63.129.16');
  }
  if (net.isIP(address) !== 6 || address.includes('.')) return false;
  const lower = address.toLowerCase(), first = parseInt(lower.split(':')[0], 16);
  // Conservative: exclude the whole IETF protocol block (2001::/16), including compressed forms.
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2001 && first !== 0x2002 && first !== 0x3fff;
}

/** CONNECT proxy pins the validated DNS address at dial time: no browser-side DNS rebinding race. */
export async function browserNetwork({ resolve = host => lookup(host,{all:true}), connect = options => net.connect(options) } = {}) {
  const sockets=new Set(); let stopped=false;
  const server=http.createServer({maxHeaderSize:8192},(_req,res)=>{res.writeHead(403,{'Connection':'close'});res.end();});
  server.maxConnections=64; server.headersTimeout=5000; server.requestTimeout=10000;
  server.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));});
  server.on('clientError',(_error,socket)=>socket.destroy());
  server.on('connect',(req,client,head)=>{
    void (async()=>{
      let url;
      try {url=new URL('https://'+req.url);} catch {client.destroy();return;}
      const host=url.hostname.replace(/^\[|\]$/g,'');
      if(stopped || (url.port && url.port!=='443') || url.username || url.password || url.pathname!=='/' || url.search || url.hash || sockets.size>48 || !host || host.length>253) {client.destroy();return;}
      // DNS is bounded by both the client count and a deadline; errors reveal no private names.
      let timer;
      let addresses;
      try {addresses=await Promise.race([net.isIP(host)?Promise.resolve([{address:host,family:net.isIP(host)}]):resolve(host),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS deadline')),5000);})]);}
      catch {client.destroy();return;}finally{clearTimeout(timer);}
      if(stopped || client.destroyed || !Array.isArray(addresses) || !addresses.length || addresses.length>32 || !addresses.every(item=>publicAddress(item.address))) {client.destroy();return;}
      const endpoint=addresses.find(item=>item.family===4)||addresses[0];
      let upstream;
      try {upstream=connect({host:endpoint.address,port:443,family:endpoint.family});}catch{client.destroy();return;}
      sockets.add(upstream);upstream.once('close',()=>{sockets.delete(upstream);client.destroy();});
      upstream.on('error',()=>client.destroy());client.once('close',()=>upstream.destroy());
      upstream.setTimeout(20000,()=>upstream.destroy());
      upstream.once('connect',()=>{
        if(stopped||client.destroyed){upstream.destroy();return;}
        upstream.setTimeout(0);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if(head.length)upstream.write(head);
        client.pipe(upstream);upstream.pipe(client);
      });
    })().catch(()=>client.destroy());
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {server:`http://127.0.0.1:${server.address().port}`,bypass:'<-loopback>',
    async close(){if(stopped)return;stopped=true;for(const socket of sockets)socket.destroy();sockets.clear();await new Promise(resolve=>server.close(resolve));}};
}
