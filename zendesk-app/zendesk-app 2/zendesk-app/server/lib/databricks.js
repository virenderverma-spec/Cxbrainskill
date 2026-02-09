const axios = require('axios');

const DATABRICKS_HOST = process.env.DATABRICKS_HOST || 'https://dbc-b7af8d94-a7ba.cloud.databricks.com';
const DATABRICKS_TOKEN = process.env.DATABRICKS_TOKEN || '';
const DATABRICKS_WAREHOUSE_ID = process.env.DATABRICKS_WAREHOUSE_ID || '';

async function databricksQuery(sql) {
  if (!DATABRICKS_TOKEN || !DATABRICKS_WAREHOUSE_ID) {
    return { error: true, message: 'Databricks not configured. Set DATABRICKS_TOKEN and DATABRICKS_WAREHOUSE_ID in .env' };
  }

  try {
    const resp = await axios.post(
      `${DATABRICKS_HOST}/api/2.0/sql/statements`,
      {
        warehouse_id: DATABRICKS_WAREHOUSE_ID,
        statement: sql,
        wait_timeout: '30s',
        disposition: 'INLINE',
        format: 'JSON_ARRAY',
      },
      {
        headers: {
          Authorization: `Bearer ${DATABRICKS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 45000,
      }
    );

    const result = resp.data;
    if (result.status?.state === 'FAILED') {
      return { error: true, message: result.status.error?.message || 'Query failed' };
    }
    if (result.status?.state === 'SUCCEEDED') {
      const columns = (result.manifest?.schema?.columns || []).map(c => c.name);
      const rows = result.result?.data_array || [];
      return { columns, rows, row_count: result.manifest?.total_row_count || rows.length };
    }
    // Still running
    return { status: result.status?.state, statement_id: result.statement_id };
  } catch (err) {
    return { error: true, message: err.response?.data?.message || err.message };
  }
}

module.exports = { databricksQuery, DATABRICKS_HOST, DATABRICKS_TOKEN };
