// api/webhook.js
// Endpoint ini didaftarkan di Dashboard Midtrans sebagai Payment Notification URL:
//   https://nama-project-kamu.vercel.app/api/webhook
// Midtrans akan memanggil URL ini otomatis setiap status pembayaran berubah.

const midtransClient = require('midtrans-client');

async function sendDiscordNotif({ orderId, itemName, playerId, grossAmount }) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return; // kalau belum diisi, lewati saja
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: '✅ Pembayaran Masuk — Vatera Store',
          color: 0xf2b93a,
          fields: [
            { name: 'Order ID', value: orderId, inline: false },
            { name: 'Item', value: itemName || '-', inline: true },
            { name: 'Player ID', value: String(playerId || '-'), inline: true },
            { name: 'Total', value: `Rp${(grossAmount || 0).toLocaleString('id-ID')}`, inline: true }
          ],
          timestamp: new Date().toISOString()
        }]
      })
    });
  } catch (err) {
    console.error('Gagal kirim notifikasi Discord:', err.message);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }

  try {
    const snap = new midtransClient.Snap({
      isProduction: process.env.MIDTRANS_PRODUCTION === 'true',
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.MIDTRANS_CLIENT_KEY
    });

    const notification = await snap.transaction.notification(req.body);
    const {
      order_id: orderId,
      transaction_status: transactionStatus,
      fraud_status: fraudStatus,
      custom_field1: itemName,
      custom_field2: playerId,
      custom_field3: grossAmountStr
    } = notification;

    if (transactionStatus === 'capture' || transactionStatus === 'settlement') {
      if (fraudStatus === 'accept' || !fraudStatus) {
        console.log(`✅ LUNAS: ${orderId} — "${itemName}" untuk player ${playerId}`);
        await sendDiscordNotif({
          orderId,
          itemName,
          playerId,
          grossAmount: Number(grossAmountStr) || 0
        });
        // TODO: panggil RCON/API server SAMP kamu di sini untuk kasih item otomatis
      }
    } else if (['deny', 'cancel', 'expire', 'failure'].includes(transactionStatus)) {
      console.log(`❌ Gagal/batal: ${orderId}`);
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Gagal memproses webhook:', err.message);
    res.status(500).send('Error');
  }
};
