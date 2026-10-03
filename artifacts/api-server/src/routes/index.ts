import { Router, type IRouter } from "express";
import healthRouter from "./health";
import purchaseRecordsRouter from "./purchase-records";
import purchaseSyncRouter from "./purchase-sync";

const router: IRouter = Router();

router.use(healthRouter);
router.use(purchaseRecordsRouter);
router.use(purchaseSyncRouter);

export default router;
