const express = require('express');
const app = express();
const qrcode = require('qrcode');
let latestQR = null;

app.get('/', async (req, res) => {
  if (!latestQR) return res.send(`<h1>👻 Ghost Bot Online</h1><p>🟢 Always Online<br>🚫 Anti Delete<br>🔓 Anti ViewOnce<br>⌨️ Fake Type+Record 10s/7s</p>`);
  res.send(`<h1>👻 Scan Ghost</h1><img src="${latestQR}" style="width:340px;border-radius:20px"/><script>setTimeout(()=>location.reload(),8000)</script>`);
});
app.listen(process.env.PORT || 3000, ()=>console.log("Ghost server online"));

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const P = require('pino');

const msgStore = new Map();
let OWNER = null;

async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
    browser: ["GhostMode","Chrome","1.0"],
    markOnlineOnConnect: true,
    syncFullHistory: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u)=>{
    if(u.qr){ latestQR = await qrcode.toDataURL(u.qr); console.log("QR READY"); }
    if(u.connection==='close'){
      if(u.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot();
    }
    if(u.connection==='open'){
      latestQR = null;
      OWNER = sock.user.id;
      console.log(`👻 GHOST CONNECTED: ${OWNER}`);
      await sock.sendPresenceUpdate('available');
      setInterval(async ()=>{ try{ await sock.sendPresenceUpdate('available'); }catch{} }, 15000);
    }
  });

  sock.ev.on('messages.upsert', async ({messages, type})=>{
    for(let m of messages){
      if(!m.message) continue;
      const from = m.key.remoteJid;
      const id = m.key.id;

      if(!m.key.fromMe && from !== 'status@broadcast'){
        msgStore.set(id, m);
      }

      if(from === 'status@broadcast' && !m.key.fromMe){
        try{
          const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger: P({level:'silent'}), reuploadRequest: sock.updateMediaMessage });
          if(buffer && OWNER){
            const mType = Object.keys(m.message)[0];
            await sock.sendMessage(OWNER, { [mType.replace('Message','')]: buffer, caption: `👁 STATUS GHOST\nFrom: ${m.pushName || from.split('@')[0]}` });
          }
        }catch{}
        continue;
      }

      const isViewOnce = m.message.viewOnceMessage || m.message.viewOnceMessageV2 || m.message.viewOnceMessageV2Extension;
      if(isViewOnce && !m.key.fromMe){
        try{
          let inner = isViewOnce.message || isViewOnce;
          if(inner.viewOnceMessage) inner = inner.viewOnceMessage;
          if(inner.viewOnceMessageV2) inner = inner.viewOnceMessageV2;
          const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger: P({level:'silent'}), reuploadRequest: sock.updateMediaMessage });
          if(OWNER){
            const actual = inner.message || inner;
            const mediaType = Object.keys(actual)[0];
            const content = {};
            content[mediaType.replace('Message','')] = buffer;
            content.caption = `🔓 *VIEW ONCE RECOVERED*\nFrom: ${m.pushName || 'Unknown'} ${from}`;
            await sock.sendMessage(OWNER, content);
          }
        }catch(e){ console.log("ViewOnce err:", e.message); }
      }

      if(type === 'notify' && !m.key.fromMe && from !== 'status@broadcast' && from !== OWNER){
        setTimeout(async ()=>{
          try{
            await sock.sendPresenceUpdate('composing', from);
            await new Promise(r=>setTimeout(r, 3500));
            await sock.sendPresenceUpdate('recording', from);
            await new Promise(r=>setTimeout(r, 3500));
            await sock.sendPresenceUpdate('paused', from);
          }catch{}
        }, 10000);
      }
    }
  });

  const sendAntiDelete = async (keys)=>{
    for(let k of keys){
      const orig = msgStore.get(k.id);
      if(orig && OWNER){
        try{
          const text = orig.message.conversation || orig.message.extendedTextMessage?.text || orig.message.imageMessage?.caption || orig.message.videoMessage?.caption || "[Media]";
          let cap = `🚫 *ANTI DELETE*\nFrom: ${orig.pushName || 'Unknown'} (${orig.key.remoteJid})\nDeleted: ${text}`;
          const hasMedia = orig.message.imageMessage || orig.message.videoMessage || orig.message.audioMessage || orig.message.documentMessage;
          if(hasMedia){
            try{
              const buf = await downloadMediaMessage(orig, 'buffer', {}, { logger: P({level:'silent'}), reuploadRequest: sock.updateMediaMessage });
              const mType = Object.keys(orig.message)[0];
              await sock.sendMessage(OWNER, { [mType.replace('Message','')]: buf, caption: cap });
            }catch{ await sock.sendMessage(OWNER, { text: cap }); }
          } else {
            await sock.sendMessage(OWNER, { text: cap });
          }
        }catch{}
      }
    }
  };

  sock.ev.on('messages.delete', async d=>{ await sendAntiDelete(d.keys); });
  sock.ev.on('messages.update', async ups=>{
    for(let u of ups){ if(u.update.message === null) await sendAntiDelete([u.key]); }
  });
}

startBot();
