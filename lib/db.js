import mongoose from 'mongoose';
let connection;
export async function db(){if(mongoose.connection.readyState===1)return mongoose.connection;if(!connection){if(!process.env.MONGODB_URI)throw new Error('MONGODB_URI is missing');connection=mongoose.connect(process.env.MONGODB_URI).catch(e=>{connection=null;throw e})}await connection;return mongoose.connection}
