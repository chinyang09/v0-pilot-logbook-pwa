/**
 * MongoDB client connection
 * SERVER-ONLY module
 */

import { MongoClient, type Db } from "mongodb"

const uri = process.env.MONGODB_URI || ""

let client: MongoClient | undefined = undefined
let clientPromise: Promise<MongoClient> | undefined = undefined

if (!uri) {
  console.warn("MONGODB_URI environment variable is not set")
}

const options = {
  compressors: [] as ("none" | "snappy" | "zlib" | "zstd")[],
  minPoolSize: 0,
  maxPoolSize: 10,
}

export async function getMongoClient(): Promise<MongoClient> {
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set")
  }

  if (client) {
    return client
  }

  if (!clientPromise) {
    client = new MongoClient(uri, options)
    clientPromise = client.connect()
  }

  return clientPromise
}

export async function getDB(): Promise<Db> {
  const mongoClient = await getMongoClient()
  return mongoClient.db("skylog")
}

export function getClientPromise(): Promise<MongoClient> {
  if (!uri) {
    return Promise.reject(new Error("No MongoDB URI"))
  }
  return getMongoClient()
}
