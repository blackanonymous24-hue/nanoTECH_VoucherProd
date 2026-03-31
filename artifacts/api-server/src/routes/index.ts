import { Router, type IRouter } from "express";
import healthRouter from "./health";
import profilesRouter from "./profiles";
import distributorsRouter from "./distributors";
import vouchersRouter from "./vouchers";
import salesRouter from "./sales";
import dashboardRouter from "./dashboard";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(profilesRouter);
router.use(distributorsRouter);
router.use(vouchersRouter);
router.use(salesRouter);
router.use(dashboardRouter);
router.use(settingsRouter);

export default router;
