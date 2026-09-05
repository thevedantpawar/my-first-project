-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'PHARMACIST', 'ADMIN');

-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('OTC', 'SCHEDULE_H', 'SCHEDULE_H1', 'AYURVEDIC', 'COSMETIC', 'NUTRACEUTICAL', 'DEVICE');

-- CreateEnum
CREATE TYPE "DosageForm" AS ENUM ('TABLET', 'CAPSULE', 'SYRUP', 'SUSPENSION', 'INJECTION', 'CREAM', 'OINTMENT', 'GEL', 'DROPS', 'INHALER', 'RESPULE', 'POWDER', 'SACHET', 'SOLUTION', 'LOTION', 'SPRAY', 'SOAP', 'PATCH', 'DEVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('UPLOADED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'CLARIFICATION_REQUESTED', 'EXPIRED', 'EXHAUSTED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PENDING_PHARMACIST_REVIEW', 'PHARMACIST_REJECTED', 'AWAITING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('RAZORPAY', 'COD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "Relation" AS ENUM ('SELF', 'SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'OTHER');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('HOME', 'WORK', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('USER_LOGIN', 'USER_LOGOUT', 'USER_REGISTER', 'PRESCRIPTION_UPLOADED', 'PRESCRIPTION_VIEWED', 'PRESCRIPTION_VERIFIED', 'PRESCRIPTION_REJECTED', 'PRESCRIPTION_CLARIFICATION_REQUESTED', 'RX_GATE_BLOCKED', 'ORDER_PLACED', 'ORDER_STATUS_CHANGED', 'ORDER_CANCELLED', 'H1_REGISTER_ENTRY_CREATED', 'H1_REGISTER_CORRECTION_FILED', 'PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_DELISTED', 'BANNED_SUBSTANCE_REJECTED', 'CLAIM_LANGUAGE_REJECTED', 'INVENTORY_ADJUSTED', 'PINCODE_ENABLED', 'PINCODE_DISABLED', 'PAYMENT_CAPTURED', 'PAYMENT_REFUNDED');

-- CreateEnum
CREATE TYPE "BannedReason" AS ENUM ('SCHEDULE_X', 'NARCOTIC', 'PSYCHOTROPIC', 'HABIT_FORMING', 'BANNED_FDC', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "phone" TEXT,
    "phoneVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'CUSTOMER',
    "pharmacistRegNo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "relation" "Relation" NOT NULL DEFAULT 'SELF',
    "gender" "Gender" NOT NULL DEFAULT 'UNDISCLOSED',
    "dateOfBirth" DATE,
    "ageYears" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" "AddressType" NOT NULL DEFAULT 'HOME',
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "landmark" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_salts" (
    "productId" TEXT NOT NULL,
    "saltId" TEXT NOT NULL,
    "strength" TEXT NOT NULL,
    "strengthValue" DOUBLE PRECISION,
    "strengthUnit" TEXT,

    CONSTRAINT "product_salts_pkey" PRIMARY KEY ("productId","saltId")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameHi" TEXT,
    "brandId" TEXT,
    "categoryId" TEXT NOT NULL,
    "manufacturerId" TEXT NOT NULL,
    "scheduleType" "ScheduleType" NOT NULL,
    "requiresPrescription" BOOLEAN NOT NULL,
    "saltKey" TEXT,
    "composition" TEXT NOT NULL,
    "strength" TEXT,
    "form" "DosageForm" NOT NULL,
    "packSize" TEXT NOT NULL,
    "packUnits" INTEGER,
    "hsnCode" TEXT NOT NULL,
    "gstRateBps" INTEGER NOT NULL,
    "mrpPaise" INTEGER NOT NULL,
    "sellingPricePaise" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "lowStockAlert" INTEGER NOT NULL DEFAULT 10,
    "maxPerOrder" INTEGER NOT NULL DEFAULT 10,
    "images" TEXT[],
    "shortDescription" TEXT,
    "uses" TEXT,
    "howItWorks" TEXT,
    "sideEffects" TEXT,
    "storage" TEXT,
    "warnings" TEXT,
    "directions" TEXT,
    "expiryPolicy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isRefrigerated" BOOLEAN NOT NULL DEFAULT false,
    "isReturnable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banned_substances" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reason" "BannedReason" NOT NULL,
    "authority" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banned_substances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_batches" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "expiryDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "costPaise" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patientId" TEXT,
    "imageKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'UPLOADED',
    "doctorName" TEXT,
    "doctorRegNo" TEXT,
    "hospitalName" TEXT,
    "issuedOn" DATE,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "pharmacistNotes" TEXT,
    "validUntil" TIMESTAMP(3),
    "refillsAllowed" INTEGER NOT NULL DEFAULT 0,
    "refillsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "prescriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentMethod" "PaymentMethod" NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "containsRxItems" BOOLEAN NOT NULL DEFAULT false,
    "containsH1Items" BOOLEAN NOT NULL DEFAULT false,
    "subtotalPaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "deliveryPaise" INTEGER NOT NULL DEFAULT 0,
    "gstPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL,
    "couponId" TEXT,
    "couponCode" TEXT,
    "shipAddressSnapshot" JSONB NOT NULL,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "razorpaySignature" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewRejectionReason" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "compositionSnapshot" TEXT NOT NULL,
    "strengthSnapshot" TEXT,
    "packSizeSnapshot" TEXT NOT NULL,
    "manufacturerSnapshot" TEXT NOT NULL,
    "scheduleTypeSnapshot" "ScheduleType" NOT NULL,
    "hsnCodeSnapshot" TEXT NOT NULL,
    "gstRateBpsSnapshot" INTEGER NOT NULL,
    "mrpPaise" INTEGER NOT NULL,
    "sellingPricePaise" INTEGER NOT NULL,
    "lineTotalPaise" INTEGER NOT NULL,
    "lineGstPaise" INTEGER NOT NULL,
    "prescriptionId" TEXT,
    "batchNumber" TEXT,
    "expiryDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "percentOff" INTEGER,
    "flatOffPaise" INTEGER,
    "maxDiscountPaise" INTEGER,
    "minOrderPaise" INTEGER NOT NULL DEFAULT 0,
    "usageLimit" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "appliesToRxItems" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_h1_register" (
    "id" TEXT NOT NULL,
    "serialNo" SERIAL NOT NULL,
    "dispensedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "prescriberName" TEXT NOT NULL,
    "prescriberRegNo" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "patientAge" INTEGER,
    "patientGender" "Gender",
    "drugName" TEXT NOT NULL,
    "composition" TEXT NOT NULL,
    "strength" TEXT,
    "form" "DosageForm" NOT NULL,
    "packSize" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "batchNumber" TEXT,
    "expiryDate" DATE,
    "pharmacistId" TEXT NOT NULL,
    "pharmacistName" TEXT NOT NULL,
    "pharmacistRegNo" TEXT NOT NULL,
    "correctsEntryId" TEXT,
    "correctionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_h1_register_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" "Role",
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serviceable_pincodes" (
    "id" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "codAvailable" BOOLEAN NOT NULL DEFAULT true,
    "etaHours" INTEGER NOT NULL DEFAULT 48,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "serviceable_pincodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "recordDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE INDEX "patients_userId_idx" ON "patients"("userId");

-- CreateIndex
CREATE INDEX "addresses_userId_idx" ON "addresses"("userId");

-- CreateIndex
CREATE INDEX "addresses_pincode_idx" ON "addresses"("pincode");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturers_name_key" ON "manufacturers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturers_slug_key" ON "manufacturers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "salts_name_key" ON "salts"("name");

-- CreateIndex
CREATE UNIQUE INDEX "salts_slug_key" ON "salts"("slug");

-- CreateIndex
CREATE INDEX "product_salts_saltId_idx" ON "product_salts"("saltId");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE INDEX "products_brandId_idx" ON "products"("brandId");

-- CreateIndex
CREATE INDEX "products_scheduleType_idx" ON "products"("scheduleType");

-- CreateIndex
CREATE INDEX "products_requiresPrescription_idx" ON "products"("requiresPrescription");

-- CreateIndex
CREATE INDEX "products_saltKey_idx" ON "products"("saltKey");

-- CreateIndex
CREATE INDEX "products_isActive_idx" ON "products"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "banned_substances_name_key" ON "banned_substances"("name");

-- CreateIndex
CREATE INDEX "inventory_batches_expiryDate_idx" ON "inventory_batches"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_batches_productId_batchNumber_key" ON "inventory_batches"("productId", "batchNumber");

-- CreateIndex
CREATE INDEX "prescriptions_userId_idx" ON "prescriptions"("userId");

-- CreateIndex
CREATE INDEX "prescriptions_status_idx" ON "prescriptions"("status");

-- CreateIndex
CREATE INDEX "prescriptions_verifiedById_idx" ON "prescriptions"("verifiedById");

-- CreateIndex
CREATE UNIQUE INDEX "carts_userId_key" ON "carts"("userId");

-- CreateIndex
CREATE INDEX "cart_items_prescriptionId_idx" ON "cart_items"("prescriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_productId_key" ON "cart_items"("cartId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "orders_razorpayOrderId_key" ON "orders"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_razorpayPaymentId_key" ON "orders"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "orders_userId_idx" ON "orders"("userId");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_containsRxItems_status_idx" ON "orders"("containsRxItems", "status");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

-- CreateIndex
CREATE INDEX "order_status_events_orderId_idx" ON "order_status_events"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_h1_register_serialNo_key" ON "schedule_h1_register"("serialNo");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_h1_register_orderItemId_key" ON "schedule_h1_register"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_h1_register_correctsEntryId_key" ON "schedule_h1_register"("correctsEntryId");

-- CreateIndex
CREATE INDEX "schedule_h1_register_dispensedAt_idx" ON "schedule_h1_register"("dispensedAt");

-- CreateIndex
CREATE INDEX "schedule_h1_register_prescriberRegNo_idx" ON "schedule_h1_register"("prescriberRegNo");

-- CreateIndex
CREATE INDEX "schedule_h1_register_pharmacistId_idx" ON "schedule_h1_register"("pharmacistId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "serviceable_pincodes_pincode_key" ON "serviceable_pincodes"("pincode");

-- CreateIndex
CREATE INDEX "serviceable_pincodes_isActive_idx" ON "serviceable_pincodes"("isActive");

-- CreateIndex
CREATE INDEX "health_records_userId_idx" ON "health_records"("userId");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_salts" ADD CONSTRAINT "product_salts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_salts" ADD CONSTRAINT "product_salts_saltId_fkey" FOREIGN KEY ("saltId") REFERENCES "salts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "manufacturers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_h1_register" ADD CONSTRAINT "schedule_h1_register_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_h1_register" ADD CONSTRAINT "schedule_h1_register_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_h1_register" ADD CONSTRAINT "schedule_h1_register_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_h1_register" ADD CONSTRAINT "schedule_h1_register_pharmacistId_fkey" FOREIGN KEY ("pharmacistId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_h1_register" ADD CONSTRAINT "schedule_h1_register_correctsEntryId_fkey" FOREIGN KEY ("correctsEntryId") REFERENCES "schedule_h1_register"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_records" ADD CONSTRAINT "health_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Ashirwad Wellness — database-level compliance enforcement
--
-- This file is appended verbatim to the initial Prisma migration. Everything
-- here holds even if the application layer is bypassed entirely: a direct psql
-- session, a stray script, a future contributor who forgets the helper.
--
-- Prisma maps model names to snake_case tables (@@map) but leaves field names
-- as-is, so columns are camelCase and must be quoted.
-- ---------------------------------------------------------------------------


-- 1. requiresPrescription is DERIVED, never asserted -------------------------
-- The Rx gate reads this column. If it could drift from scheduleType, the gate
-- would be a lie. This makes drift impossible rather than unlikely.

ALTER TABLE "products"
  ADD CONSTRAINT "products_requires_prescription_derived"
  CHECK ("requiresPrescription" = ("scheduleType" IN ('SCHEDULE_H', 'SCHEDULE_H1')));


-- 2. Schedule X / narcotics / psychotropics are unrepresentable -------------
-- The enum already has no member for them. This constraint is deliberately
-- redundant: it means a future ALTER TYPE ... ADD VALUE cannot silently make
-- controlled substances listable without someone also dropping this constraint
-- and explaining why in a migration.

ALTER TABLE "products"
  ADD CONSTRAINT "products_permitted_schedule_types"
  CHECK ("scheduleType" IN (
    'OTC', 'SCHEDULE_H', 'SCHEDULE_H1',
    'AYURVEDIC', 'COSMETIC', 'NUTRACEUTICAL', 'DEVICE'
  ));


-- 3. Banned-substance guard --------------------------------------------------
-- Constraint 2 stops someone listing a controlled drug *honestly*. This stops
-- them listing one dishonestly, by tagging pentazocine as OTC. Matches the
-- product name and composition against the banned list on every write.

CREATE OR REPLACE FUNCTION "reject_banned_substance"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  hit RECORD;
  haystack TEXT;
BEGIN
  haystack := lower(NEW."name" || ' ' || NEW."composition");

  SELECT b."name", b."reason", b."authority"
    INTO hit
    FROM "banned_substances" b
   WHERE position(b."name" IN haystack) > 0
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Refused to list product %: contains banned substance "%" (%). Authority: %',
      NEW."name", hit."name", hit."reason", COALESCE(hit."authority", 'not recorded')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "products_banned_substance_guard"
  BEFORE INSERT OR UPDATE OF "name", "composition" ON "products"
  FOR EACH ROW EXECUTE FUNCTION "reject_banned_substance"();


-- 4. A Schedule H/H1 line cannot be dispensed without a prescription ---------
-- The server action checks this. So does the database. Belt and braces,
-- because this is the single constraint the whole build exists to honour.

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_rx_requires_prescription"
  CHECK (
    "scheduleTypeSnapshot" NOT IN ('SCHEDULE_H', 'SCHEDULE_H1')
    OR "prescriptionId" IS NOT NULL
  );


-- 5. Money and tax sanity ----------------------------------------------------

ALTER TABLE "products"
  ADD CONSTRAINT "products_price_sane"
  CHECK ("mrpPaise" > 0 AND "sellingPricePaise" > 0 AND "sellingPricePaise" <= "mrpPaise");

ALTER TABLE "products"
  ADD CONSTRAINT "products_gst_slab"
  CHECK ("gstRateBps" IN (0, 500, 1200, 1800, 2800));

ALTER TABLE "products"
  ADD CONSTRAINT "products_stock_non_negative"
  CHECK ("stock" >= 0);


-- 6. Refill budget cannot be overdrawn --------------------------------------

ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_refills_within_budget"
  CHECK ("refillsUsed" >= 0 AND "refillsAllowed" >= 0 AND "refillsUsed" <= "refillsAllowed");


-- 7. A coupon is either percentage-off or flat-off, never both, never neither -

ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_exactly_one_discount_kind"
  CHECK (("percentOff" IS NULL) <> ("flatOffPaise" IS NULL));

ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_percent_range"
  CHECK ("percentOff" IS NULL OR ("percentOff" > 0 AND "percentOff" <= 100));


-- 8. Append-only registers ---------------------------------------------------
-- Rule 65(11A) requires the H1 register to be a register, not a spreadsheet.
-- A row, once written, is permanent. Corrections are filed as new rows via
-- "correctsEntryId". The audit log gets identical treatment.
--
-- These triggers fire for the table owner too. Rewriting history requires
-- dropping the trigger, which is itself a schema change with a paper trail.

CREATE OR REPLACE FUNCTION "reject_mutation_append_only"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only; % is not permitted. File a correcting entry instead.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "schedule_h1_register_append_only"
  BEFORE UPDATE OR DELETE ON "schedule_h1_register"
  FOR EACH ROW EXECUTE FUNCTION "reject_mutation_append_only"();

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "reject_mutation_append_only"();

-- TRUNCATE bypasses row-level triggers, so it needs its own statement-level one.
CREATE TRIGGER "schedule_h1_register_no_truncate"
  BEFORE TRUNCATE ON "schedule_h1_register"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_mutation_append_only"();

CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_mutation_append_only"();


-- 9. A correcting H1 entry must state why ------------------------------------

ALTER TABLE "schedule_h1_register"
  ADD CONSTRAINT "h1_correction_requires_reason"
  CHECK ("correctsEntryId" IS NULL OR "correctionReason" IS NOT NULL);


-- 10. Search support ---------------------------------------------------------
-- Trigram indexes for typo-tolerant search across product name, brand, and
-- salt (Phase 2). pg_trgm ships with Postgres contrib.

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE INDEX "products_name_trgm" ON "products" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "products_composition_trgm" ON "products" USING GIN ("composition" gin_trgm_ops);
CREATE INDEX "salts_name_trgm" ON "salts" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "brands_name_trgm" ON "brands" USING GIN ("name" gin_trgm_ops);
