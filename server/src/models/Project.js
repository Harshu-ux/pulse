'use strict';

const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // SHA-256 of the API key. The raw key is shown once at creation and never stored.
    apiKeyHash: { type: String, required: true, unique: true },
    // First characters of the key, so users can tell keys apart in the UI.
    apiKeyPrefix: { type: String, required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Project || mongoose.model('Project', projectSchema);
