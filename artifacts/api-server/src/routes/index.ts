import { Router } from "express";
import routersRouter from "./routers.js";
import vouchersRouter from "./vouchers.js";
import vendorsRouter from "./vendors.js";
import dashboardRouter from "./dashboard.js";
import vendorPortalRouter from "./vendor-portal.js";
import renderRouter from "./render.js";
import adminRouter from "./admin.js";
import managersRouter from "./managers.js";
import collaborateursRouter from "./collaborateurs.js";

export const router = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

router.use(routersRouter);
router.use(vouchersRouter);
router.use(vendorsRouter);
router.use(dashboardRouter);
router.use(vendorPortalRouter);
router.use(renderRouter);
router.use(adminRouter);
router.use(managersRouter);
router.use(collaborateursRouter);
