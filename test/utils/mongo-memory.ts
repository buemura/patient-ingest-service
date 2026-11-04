import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Connection } from 'mongoose';

export async function startMongo(): Promise<{
  connection: Connection;
  stop: () => Promise<void>;
}> {
  const server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const connection = await mongoose
    .createConnection(server.getUri(), { dbName: 'ingest-test' })
    .asPromise();

  return {
    connection,
    stop: async () => {
      await connection.close();
      await server.stop();
    },
  };
}
