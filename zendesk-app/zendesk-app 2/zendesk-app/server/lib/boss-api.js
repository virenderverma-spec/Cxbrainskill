const axios = require('axios');

const BOSS_API_URL = process.env.BOSS_API_URL || 'https://prod-boss-api.rockstar-automations.com';
const BOSS_API_KEY = process.env.BOSS_API_KEY || '';

async function bossApi(method, endpoint, params) {
  const url = `${BOSS_API_URL}${endpoint}`;
  const headers = { 'Content-Type': 'application/json' };
  if (BOSS_API_KEY) headers['X-API-Key'] = BOSS_API_KEY;

  try {
    const resp = await axios({ method, url, headers, params, timeout: 15000 });
    return resp.data;
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    return { error: true, status, message: data?.message || err.message };
  }
}

module.exports = { bossApi, BOSS_API_URL };
