'use strict';

const mongoose = require('mongoose');
const Project = require('../models/Project');
const Event = require('../models/Event');

async function connectMongo(url) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(url);
  // Make sure the time-series collection and indexes exist before workers write to it.
  await Event.createCollection().catch((err) => {
    if (err.codeName !== 'NamespaceExists') throw err;
  });
  await Promise.all([Event.syncIndexes(), Project.syncIndexes()]);
}

/** Project lookups used by the API key middleware. */
const projectRepo = {
  async findByKeyHash(hash) {
    const p = await Project.findOne({ apiKeyHash: hash }).lean();
    return p ? { id: String(p._id), name: p.name } : null;
  },
};

/** Event writes used by the ingest worker. */
const eventStore = {
  async insertEvents(docs) {
    if (docs.length === 0) return 0;
    // ordered:false lets MongoDB write the batch in parallel internally.
    const result = await Event.insertMany(docs, { ordered: false, lean: true, rawResult: true });
    return result.insertedCount;
  },
};

module.exports = { connectMongo, projectRepo, eventStore };
