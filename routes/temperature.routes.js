// routes/temperature.routes.js
import express from "express";
import TemperatureController from "../controllers/temperature.controller.js";

const router = express.Router();

router.get("/", TemperatureController.getDataByRange);
router.get("/monthly", TemperatureController.getMonthlyStats);

export default router;