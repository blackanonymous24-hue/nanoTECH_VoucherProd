import { Router } from "express";
import routersRouter from "./routers.js";
import vouchersRouter from "./vouchers.js";
import dashboardRouter from "./dashboard.js";

export const router = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

router.use(routersRouter);
router.use(vouchersRouter);
router.use(dashboardRouter);
