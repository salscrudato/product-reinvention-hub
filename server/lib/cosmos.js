'use strict'
// cosmos.js — the single Cosmos DB client + container handles.
// Endpoint/key come from App Service settings COSMOS_ENDPOINT / COSMOS_KEY.
// Throws on require if unset, so server.js skips mounting /api/db until wired.

const { CosmosClient } = require('@azure/cosmos')

const endpoint = process.env.COSMOS_ENDPOINT
const key = process.env.COSMOS_KEY
if (!endpoint || !key) throw new Error('COSMOS_ENDPOINT / COSMOS_KEY not set')

const client = new CosmosClient({ endpoint, key })
const database = client.database(process.env.COSMOS_DB || 'prodhub')
const docs = database.container('docs')
const presence = database.container('presence')

module.exports = { client, database, docs, presence }
