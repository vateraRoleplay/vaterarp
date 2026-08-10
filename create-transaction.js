// api/create-transaction.js
// Endpoint ini dipanggil dari website saat user klik "Bayar Otomatis".
// Di Vercel, taruh file ini di folder /api — otomatis jadi endpoint:
//   https://nama-project-kamu.vercel.app/api/create-transaction

const midtransClient = require('midtrans-client');

function parseHarga(hargaText) {
  const angka = parseInt(String(hargaText).replace(/[^0-9]/g, ''), 10) || 0;
  return angka * 1000;
}

module.exports = async (req, res) => {
  // Izinkan dipanggil dari domain website kamu (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { itemId, itemName, harga, playerId } = req.body || {};
    if (!itemId || !itemName || !harga || !playerId) {
      return res.status(400).json({ error: 'Data tidak lengkap' });
    }

    const snap = new midtransClient.Snap({
      isProduction: process.env.MIDTRANS_PRODUCTION === 'true',
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.MIDTRANS_CLIENT_KEY
    });

    const orderId = `VATERA-${itemId}-${Date.now()}`;
    const grossAmount = parseHarga(harga);

    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount
      },
      item_details: [{
        id: String(itemId),
        price: grossAmount,
        quantity: 1,
        name: itemName
      }],
      customer_details: {
        first_name: `Player-${playerId}`
      },
      // TRIK: karena serverless function tidak "ingat" data antar request,
      // kita titipkan detail order lewat custom_field supaya nanti
      // dikembalikan lagi oleh Midtrans saat webhook dipanggil.
      custom_field1: itemName,
      custom_field2: String(playerId),
      custom_field3: String(grossAmount)
    };

    const transaction = await snap.createTransaction(parameter);
    res.status(200).json({ token: transaction.token, orderId });
  } catch (err) {
    console.error('Gagal membuat transaksi:', err.message);
    res.status(500).json({ error: 'Gagal membuat transaksi' });
  }
};
