/** An EMPTY database: the server's start-up migration and the wizard must do everything else. */
import { createConnection } from 'mysql2/promise'
import { SERVER_URL } from '../e2e/config'
import { SETUP_DB } from './config'

const admin = await createConnection(SERVER_URL)
await admin.query(`DROP DATABASE IF EXISTS \`${SETUP_DB}\``)
await admin.query(`CREATE DATABASE \`${SETUP_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
await admin.end()
