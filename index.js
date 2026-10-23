const express = require('express');
const app = express();
const qrcode = require('qrcode');
let latestQR = null;

app.get('/', async (req, res) => {
  if (!latestQR) return res.send(`<h1>👻 Ghost Bot Online</h1><p>Scan QR - Ghost Mode Active</p><ul><li>Freeze Last Seen</li><li>Always Online</li><li>Read without Blue Tick</li><li>View Status without Seen</li><li>Anti Delete to DM</li><li>Anti ViewOnce to DM</li></ul>`);
  res.send(`<h1>👻 Scan to Activate Ghost</h1><img src="${latestQR}" style="width:340px;border-radius:20px"/><p>After scan, don't open WhatsApp app to keep last seen frozen</p><script>setTimeout(()=>location.reload(),8000)</script>`);
});
app.listen(process.env.PORT || 3000);

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
    markOnlineOnConnect: true, // KEEPS LAST SEEN FROZEN
    syncFullHistory: true,
    shouldIgnoreJid: jid => false,
    // 👻 GHOST: Don't send read receipts automatically
    shouldSyncHistoryMessage: () => false,
    markOnlineOnConnect: true
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
      console.log(`👻 GHOST CONNECTED - OWNER: ${OWNER}`);
      await sock.sendMessage(OWNER, { text: `👻 *GHOST MODE ACTIVATED*\n\n🟢 Always Online: ON\n❄️ Freeze Last Seen: ON (don't open WhatsApp app)\n👁️ Read without Blue Tick: ON\n👁️ View Status without Seen: ON\n🚫 Anti Delete: ON -> here\n🔓 Anti ViewOnce: ON -> here\n🔴 Fake Recording: ON\n\n*To keep last seen frozen: Use only this bot, don't open WhatsApp on phone*` });
      // ALWAYS ONLINE LOOP
      await sock.sendPresenceUpdate('available');
      setInterval(async ()=>{ try{ await sock.sendPresenceUpdate('available'); }catch{} }, 20000);
    }
  });

  sock.ev.on('messages.upsert', async ({messages, type})=>{
    for(let m of messages){
      if(!m.message) continue;
      const from = m.key.remoteJid;
      const id = m.key.id;

      // SAVE FOR ANTI DELETE (only incoming)
      if(!m.key.fromMe && from !== 'status@broadcast'){
        msgStore.set(id, m);
      }

      // 👻 GHOST STATUS VIEW - Save status without marking seen
      if(from === 'status@broadcast' && !m.key.fromMe){
        try{
          const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger: P({level:'silent'}), reuploadRequest: sock.updateMediaMessage }).catch(()=>null);
          if(buffer && OWNER){
            const mediaType = Object.keys(m.message)[0];
            await sock.sendMessage(OWNER, { 
              [mediaType.replace('Message','')]: buffer, 
              caption: `👁️ *GHOST STATUS*\nFrom: ${m.pushName || from.split('@')[0]}\nNumber: ${from}\n(They don't know you viewed)` 
            });
          }
        }catch{}
        continue; // Don't mark as read
      }

      // 🔓 ANTI VIEW ONCE -> DM
      if(m.message.viewOnceMessage || m.message.viewOnceMessageV2 || m.message.viewOnceMessageV2Extension){
        try{
          const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger: P({level:'silent'}), reuploadRequest: sock.updateMediaMessage });
          const inner = m.message.viewOnceMessage || m.message.viewOnceMessageV2 || m.message.viewOnceMessageV2Extension;
          const mediaType = Object.keys(inner.message)[0];
          await sock.sendMessage(OWNER, { [mediaType.replace('Message','')]: buffer, caption: `🔓 *ANTI VIEW ONCE*\nFrom: ${m.pushName} ${from}` });
        }catch(e){ console.log(e.message); }
      }

      // 👻 GHOST READ + FAKE RECORDING
      if(type === 'notify' && !m.key.fromMe && from !== 'status@broadcast' && from !== OWNER){
        // Show fake recording but DON'T send read receipt
        await sock.sendPresenceUpdate('composing', from);
        await new Promise(r=>setTimeout(r, 800));
        await sock.sendPresenceUpdate('recording', from);
        await new Promise(r=>setTimeout(r, 1200));
        await sock.sendPresenceUpdate('paused', from);
        // NO sock.readMessages() -> no blue tick 👻
      }
    }
  });

  // 🚫 ANTI DELETE
  const sendAntiDelete = async (keys)=>{
    for(let k of keys){
      const orig = msgStore.get(k.id);
      if(orig && OWNER){
        try{
          const text = orig.message.conversation || orig.message.extendedTextMessage?.text || orig.message.imageMessage?.caption || "[Media deleted]";
          const hasMedia = orig.message.imageMessage || orig.message.videoMessage || orig.message.audioMessage || orig.message.documentMessage;
          let cap = `🚫 *ANTI DELETE*\nFrom: ${orig.pushName || 'Unknown'} (${orig.key.remoteJid})\nDeleted: ${text}`;
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
