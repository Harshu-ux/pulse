'use strict';

const express = require('express');
const { z } = require('zod');
const Project = require('../models/Project');
const Event = require('../models/Event');
const { generateApiKey, hashApiKey } = require('../lib/apiKeys');
const { loadOwnedProject } = require('../middleware/requireUser');

const nameSchema = z.object({ name: z.string().trim().min(1, 'name is required').max(100) });

const publicProject = (p) => ({
  id: String(p._id),
  name: p.name,
  apiKeyPrefix: p.apiKeyPrefix,
  createdAt: p.createdAt,
});

function projectsRouter() {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const projects = await Project.find({ ownerId: req.user.id }).sort({ createdAt: 1 }).lean();
      res.json({ projects: projects.map(publicProject) });
    } catch (err) {
      next(err);
    }
  });

  // The full API key is returned only here and on rotation; afterwards only its prefix is known.
  router.post('/', async (req, res, next) => {
    const parsed = nameSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    try {
      const apiKey = generateApiKey();
      const project = await Project.create({
        name: parsed.data.name,
        ownerId: req.user.id,
        apiKeyHash: hashApiKey(apiKey),
        apiKeyPrefix: apiKey.slice(0, 10),
      });
      return res.status(201).json({ project: publicProject(project), apiKey });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:projectId', loadOwnedProject, (req, res) => res.json({ project: publicProject(req.project) }));

  router.post('/:projectId/rotate-key', loadOwnedProject, async (req, res, next) => {
    try {
      const apiKey = generateApiKey();
      const project = await Project.findByIdAndUpdate(
        req.project._id,
        { apiKeyHash: hashApiKey(apiKey), apiKeyPrefix: apiKey.slice(0, 10) },
        { new: true },
      ).lean();
      res.json({ project: publicProject(project), apiKey });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:projectId', loadOwnedProject, async (req, res, next) => {
    try {
      await Event.deleteMany({ 'meta.projectId': String(req.project._id) });
      await Project.deleteOne({ _id: req.project._id });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { projectsRouter };
