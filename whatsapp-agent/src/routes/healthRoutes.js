'use strict';

const express = require('express');
const humanReviewQueue = require('../review/humanReviewQueue');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, openReviewItems: humanReviewQueue.listOpen().length });
});

module.exports = router;
