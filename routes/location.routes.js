// routes/location.routes.js
import express from "express";
import LocationModel from "../models/location.model.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const locations = await LocationModel.getAll();
    res.json(locations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const location = await LocationModel.getById(req.params.id);
    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }
    res.json(location);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;