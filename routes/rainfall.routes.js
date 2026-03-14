// routes/rainfall.routes.js
import express from "express";
import RainfallController from "../controllers/rainfall.controller.js";

const router = express.Router();

router.get("/", RainfallController.getDataByRange);
router.get("/monthly", RainfallController.getMonthlyStats);
router.get("/yearly", RainfallController.getYearlyStats);
router.get("/compare-periods", RainfallController.comparePeriods);
router.get("/compare-locations", RainfallController.compareLocations);

export default router;