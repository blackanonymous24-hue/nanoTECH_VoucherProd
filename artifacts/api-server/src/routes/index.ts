import { Router } from "express";
import { clientDisconnectMiddleware } from "../lib/request-signal.js";
import { sessionEpochMiddleware } from "../lib/session-epoch-middleware.js";
import routersRouter from "./routers.js";
import vouchersRouter from "./vouchers.js";
import vendorsRouter from "./vendors.js";
import dashboardRouter from "./dashboard.js";
import vendorPortalRouter from "./vendor-portal.js";
import adminRouter from "./admin.js";
import superAdminRouter from "./super-admin.js";
import managersRouter from "./managers.js";
import collaborateursRouter from "./collaborateurs.js";
import builtinTemplatesRouter from "./builtin-templates.js";

export const router = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

router.use(clientDisconnectMiddleware);
router.use(sessionEpochMiddleware);

router.use(routersRouter);
router.use(vouchersRouter);
router.use(vendorsRouter);
router.use(dashboardRouter);
router.use(vendorPortalRouter);
router.use(adminRouter);
router.use(superAdminRouter);
router.use(managersRouter);
router.use(collaborateursRouter);
router.use(builtinTemplatesRouter);
