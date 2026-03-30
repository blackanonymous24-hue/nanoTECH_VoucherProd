import { Router, type IRouter } from "express";
import healthRouter from "./health";
import profilesRouter from "./profiles";
import vouchersRouter from "./vouchers";
import salesRouter from "./sales";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(profilesRouter);
router.use(vouchersRouter);
router.use(salesRouter);
router.use(dashboardRouter);

export default router;
