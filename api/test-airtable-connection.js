require('dotenv').config();
const axios = require('axios');

// Load environment variables from env.json
const envConfig = require('./env.json');
Object.assign(process.env, envConfig.Variables);

async function testAirtableConnection() {
  const baseId = process.env.AIRTABLE_BASE;
  const token = process.env.AIRTABLE_TOKEN;
  const tableName = process.env.AIRTABLE_TABLE_NAME || 'Projects';

  console.log('Testing Airtable connection...');
  console.log('Base ID:', baseId);
  console.log('Table Name:', tableName);
  console.log('Token prefix:', token ? token.substring(0, 20) + '...' : 'Not set');

  try {
    // Test 1: List bases to verify token works
    console.log('\n1. Testing token validity by listing bases...');
    const basesResponse = await axios.get(
      'https://api.airtable.com/v0/meta/bases',
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    console.log('✅ Token is valid. Found', basesResponse.data.bases.length, 'bases');

    // Test 2: List tables in the base
    console.log('\n2. Listing tables in base', baseId, '...');
    const schemaResponse = await axios.get(
      `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    console.log('Tables in base:');
    schemaResponse.data.tables.forEach(table => {
      console.log(`  - ${table.name} (id: ${table.id})`);
      if (table.fields) {
        console.log('    Fields:', table.fields.map(f => f.name).join(', '));
      }
    });

    // Test 3: Try to read from the Projects table
    console.log(`\n3. Testing read access to '${tableName}' table...`);
    const recordsResponse = await axios.get(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?maxRecords=3`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    console.log(`✅ Successfully read from ${tableName} table`);
    console.log('Found', recordsResponse.data.records.length, 'records');
    
    if (recordsResponse.data.records.length > 0) {
      console.log('\nFirst record fields:');
      const firstRecord = recordsResponse.data.records[0];
      console.log('  Fields:', Object.keys(firstRecord.fields));
      console.log('  Data:', JSON.stringify(firstRecord.fields, null, 2));
    }

  } catch (error) {
    console.error('\n❌ Error:', error.response?.data || error.message);
    if (error.response?.status === 403) {
      console.error('\nAuthorization error. Please check:');
      console.error('1. Token has "data.records:read" scope');
      console.error('2. Token has access to base', baseId);
      console.error('3. Table name is correct');
    }
  }
}

testAirtableConnection();