'use strict';

const mongoose = require('mongoose');
const { verifyToken } = require('../lib/auth');
const Project = require('../models/Project');

/** Requires a valid "Authorization: Bearer <jwt>" header. */
function requireUser(config) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = verifyToken(token, config);
    if (!user) return res.status(401).json({ error: 'not signed in' });
    req.user = user;
    return next();
  };
}

/**
 * Loads :projectId and checks the signed-in user owns it. Answers 404 (not 403)
 * for other people's projects so project IDs can't be probed.
 */
async function loadOwnedProject(req, res, next) {
  const { projectId } = req.params;
  if (!mongoose.isValidObjectId(projectId)) return res.status(404).json({ error: 'project not found' });
  try {
    const project = await Project.findOne({ _id: projectId, ownerId: req.user.id }).lean();
    if (!project) return res.status(404).json({ error: 'project not found' });
    req.project = project;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireUser, loadOwnedProject };
