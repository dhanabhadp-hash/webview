import { Router, type IRouter } from "express";
import healthRouter from "./health";
import purchaseRecordsRouter from "./purchase-records";

const router: IRouter = Router();

router.use(healthRouter);
router.use(purchaseRecordsRouter);

export default router;
