import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient({
  datasources: dbUrl ? { db: { url: dbUrl } } : undefined,
});

async function main() {
  console.log("🌱 Starting Database Seed with Part 1 Demo Data...");

  // 0. Reset demo tenants so the seed is idempotent (cascades to all child rows)
  await prisma.organization.deleteMany({
    where: { id: { in: ["org_acme", "org_rf"] } },
  });

  // 1. Create Demo Organization
  const org = await prisma.organization.create({
    data: {
      id: "org_acme",
      name: "Acme Corp",
      plan: "Enterprise",
    },
  });
  console.log(`✓ Organization created: ${org.name}`);

  // 2. Create Primary Demo Users
  const jordan = await prisma.user.create({
    data: {
      id: "usr_jordan",
      organizationId: org.id,
      name: "Jordan Ellis",
      email: "jordan.ellis@acmecorp.com",
      role: "ADMIN",
      avatarInitials: "JE",
    },
  });

  const priya = await prisma.user.create({
    data: {
      id: "usr_priya",
      organizationId: org.id,
      name: "Priya Sharma",
      email: "priya.sharma@acmecorp.com",
      role: "MEMBER",
      avatarInitials: "PS",
    },
  });

  const tom = await prisma.user.create({
    data: {
      id: "usr_tom",
      organizationId: org.id,
      name: "Tom Kwan",
      email: "tom.kwan@acmecorp.com",
      role: "MEMBER",
      avatarInitials: "TK",
    },
  });

  const ana = await prisma.user.create({
    data: {
      id: "usr_ana",
      organizationId: org.id,
      name: "Ana Reyes",
      email: "ana.reyes@acmecorp.com",
      role: "MEMBER",
      avatarInitials: "AR",
    },
  });

  const marcus = await prisma.user.create({
    data: {
      id: "usr_marcus",
      organizationId: org.id,
      name: "Marcus Lee",
      email: "marcus.lee@acmecorp.com",
      role: "MEMBER",
      avatarInitials: "ML",
    },
  });

  // RF Operations support seats (isRFTeam identifies the RF Operations side)
  const rfTech = await prisma.user.create({
    data: {
      id: "usr_rf_tech",
      organizationId: org.id,
      name: "RF Technical Specialist",
      email: "tech@rf-intelligence.com",
      role: "MEMBER",
      avatarInitials: "RF",
      isRFTeam: true,
    },
  });

  const rfOnboard = await prisma.user.create({
    data: {
      id: "usr_rf_onboard",
      organizationId: org.id,
      name: "RF Onboarding AI Specialist",
      email: "onboarding@rf-intelligence.com",
      role: "MEMBER",
      avatarInitials: "RF",
      isRFTeam: true,
    },
  });

  const rfData = await prisma.user.create({
    data: {
      id: "usr_rf_data",
      organizationId: org.id,
      name: "RF Data Engineering",
      email: "data@rf-intelligence.com",
      role: "MEMBER",
      avatarInitials: "RF",
      isRFTeam: true,
    },
  });

  // Per-user notification delivery preferences
  await prisma.notificationPreference.createMany({
    data: [jordan, priya, tom, ana, marcus, rfTech, rfOnboard, rfData].map(
      (user) => ({
        userId: user.id,
        organizationId: org.id,
      }),
    ),
  });
  console.log("✓ Demo Users created");

  // 3. Create Active Projects & Activities
  const projHorizon = await prisma.project.create({
    data: {
      id: "proj_horizon",
      organizationId: org.id,
      ownerId: priya.id,
      name: "Horizon v2 Launch",
      accountName: "Meridian Health",
      status: "ON_TRACK",
      progress: 72,
      dueDate: new Date("2026-09-28T00:00:00Z"),
      openTasksCount: 4,
      activities: {
        create: [
          {
            organizationId: org.id,
            authorId: priya.id,
            action: "Updated progress to 72%",
            details: "Completed API integration milestone on schedule.",
            type: "status",
          },
          {
            organizationId: org.id,
            authorId: jordan.id,
            action: "Added task: Finalize staging verification",
            type: "task",
          },
        ],
      },
    },
  });

  const projAcme = await prisma.project.create({
    data: {
      id: "proj_renewal_acme",
      organizationId: org.id,
      ownerId: jordan.id,
      name: "Acme Renewal Prep",
      accountName: "Acme Corp",
      status: "AT_RISK",
      progress: 45,
      dueDate: new Date("2026-09-20T00:00:00Z"),
      openTasksCount: 9,
      activities: {
        create: [
          {
            organizationId: org.id,
            authorId: jordan.id,
            action: "Flagged project as At Risk",
            details: "Executive sponsor turnover detected on customer side.",
            type: "status",
          },
        ],
      },
    },
  });
  console.log("✓ Projects & Activities created");

  // 4. Create AI Insights
  await prisma.insight.create({
    data: {
      id: "ins_pipeline_conc",
      organizationId: org.id,
      type: "RISK",
      severity: "CRITICAL",
      title: "Pipeline concentration risk",
      body: "3 accounts represent 61% of Q4 ARR. Diversification recommended before close period.",
      accountName: null,
      ctaHref: "/ai-insights",
      ctaLabel: "View analysis",
      read: false,
      whatHappened: "Three major Enterprise accounts comprise 61% ($2.4M) of total forecasted pipeline for Q4 2026.",
      whyDetected: "RF Intelligence calculated an HHI concentration score of 0.38 across pipeline deals, exceeding safe threshold (0.20).",
      chartTitle: "Pipeline Share by Top Accounts vs Threshold (%)",
      chartType: "bar",
      chartDataJson: JSON.stringify([
        { label: "Acme Corp", value: 26, benchmark: 10 },
        { label: "Meridian", value: 20, benchmark: 10 },
        { label: "GlobalFin", value: 15, benchmark: 10 },
      ]),
      businessImpact: "If any single top-3 deal slips or churns, Q4 target attainment will drop below baseline.",
      recommendedAction: "Accelerate stage-2 opportunities in mid-market tier.",
    },
  });
  console.log("✓ AI Insights created");

  // 5. Create Documents & Reports
  await prisma.document.create({
    data: {
      id: "doc_1",
      organizationId: org.id,
      uploadedById: jordan.id,
      fileName: "Acme_Master_Services_Agreement_2026.pdf",
      fileSize: "4.5 MB",
      fileUrl: "https://storage.rf-intelligence.com/docs/acme_msa.pdf",
      mimeType: "application/pdf",
      storageKey: `${org.id}/seed/acme_msa.pdf`,
      processingStatus: "PROCESSED",
      linkedAccount: "Acme Corp",
      extractedEntitiesCount: 38,
      metadataJson: JSON.stringify({
        extension: "pdf",
        contentType: "application/pdf",
        wordCount: null,
        entitiesCount: 38,
      }),
    },
  });

  await prisma.report.create({
    data: {
      id: "rep_1",
      organizationId: org.id,
      createdById: jordan.id,
      title: "GlobalFin Q3 QBR Presentation Deck",
      type: "QBR Deck",
      accountName: "GlobalFin",
      size: "14.2 MB",
      status: "READY",
      fileUrl: "https://storage.rf-intelligence.com/reports/globalfin_qbr.pdf",
    },
  });

  // Metadata-only report generated for the seeded processed document (mirrors
  // the report the document processor creates for real uploads).
  await prisma.report.create({
    data: {
      id: "rep_doc_1",
      organizationId: org.id,
      createdById: jordan.id,
      documentId: "doc_1",
      title: "Analysis: Acme_Master_Services_Agreement_2026.pdf",
      type: "Document Analysis",
      accountName: "Acme Corp",
      size: "4.5 MB",
      status: "READY",
      fileUrl: "https://storage.rf-intelligence.com/docs/acme_msa.pdf",
    },
  });
  console.log("✓ Documents & Reports created");

  // 6. Create Internal Conversations & Messages (Client Team ↔ RF Operations)
  const now = Date.now();
  const minutesAgo = (m: number) => new Date(now - m * 60_000);

  await prisma.conversation.create({
    data: {
      id: "int_1",
      organizationId: org.id,
      topic: "Acme Renewal Strategy & Risk Mitigation",
      contextLabel: "Account: Acme Corp",
      rfLead: "RF Intelligence Support",
      unread: true,
      createdAt: minutesAgo(180),
      updatedAt: minutesAgo(4),
      messages: {
        create: [
          {
            organizationId: org.id,
            senderId: priya.id,
            isRFTeam: false,
            createdAt: minutesAgo(9),
            content:
              "Can we sync on the Acme renewal deck before EOD? I have concerns about slide 4 sentiment metrics.",
          },
          {
            organizationId: org.id,
            senderId: rfTech.id,
            isRFTeam: true,
            createdAt: minutesAgo(6),
            content:
              "Hi Priya! I reviewed slide 4. The sentiment metric calculated a 0.41 score based on recent executive turnover phrasing. We can adjust the weighting model if you have offline context.",
          },
          {
            organizationId: org.id,
            senderId: jordan.id,
            isRFTeam: false,
            createdAt: minutesAgo(4),
            content: "Thanks! Let's lock in an offline review at 3 PM today.",
          },
        ],
      },
    },
  });

  await prisma.conversation.create({
    data: {
      id: "int_2",
      organizationId: org.id,
      topic: "Northstar Onboarding Sign-off",
      contextLabel: "Project: Northstar Onboarding",
      rfLead: "RF Onboarding AI Specialist",
      unread: false,
      createdAt: minutesAgo(180),
      updatedAt: minutesAgo(46),
      messages: {
        create: [
          {
            organizationId: org.id,
            senderId: tom.id,
            isRFTeam: false,
            createdAt: minutesAgo(48),
            content: "Northstar onboarding is basically done. Final checklist attached.",
          },
          {
            organizationId: org.id,
            senderId: rfOnboard.id,
            isRFTeam: true,
            createdAt: minutesAgo(46),
            content:
              "Verified. All 24 user accounts pass compliance policy checks. Ready for final handover.",
          },
        ],
      },
    },
  });

  await prisma.conversation.create({
    data: {
      id: "int_3",
      organizationId: org.id,
      topic: "GlobalFin QBR Data Integration Blocker",
      contextLabel: "Project: GlobalFin QBR Deck",
      rfLead: "RF Data Engineering",
      unread: false,
      createdAt: minutesAgo(180),
      updatedAt: minutesAgo(118),
      messages: {
        create: [
          {
            organizationId: org.id,
            senderId: ana.id,
            isRFTeam: false,
            createdAt: minutesAgo(122),
            content:
              "Blocked on GlobalFin QBR — need the usage export from integrations.",
          },
          {
            organizationId: org.id,
            senderId: rfData.id,
            isRFTeam: true,
            createdAt: minutesAgo(118),
            content:
              "Export is running now. I'll drop the signed URL into this thread once the warehouse job completes.",
          },
        ],
      },
    },
  });
  console.log("✓ Internal Conversations & Messages created");

  // 7. Create Notification Bell entries
  await prisma.notification.createMany({
    data: [
      {
        organizationId: org.id,
        userId: jordan.id,
        title: "New AI insight ready",
        body: "Q3 pipeline analysis is complete.",
        read: false,
        createdAt: minutesAgo(2),
      },
      {
        organizationId: org.id,
        userId: jordan.id,
        title: "Project updated",
        body: "Horizon v2 milestones were updated by Priya.",
        read: false,
        createdAt: minutesAgo(18),
      },
      {
        organizationId: org.id,
        userId: jordan.id,
        title: "Message from Priya S.",
        body: "Can we sync on the renewal deck?",
        read: true,
        createdAt: minutesAgo(63),
      },
      {
        organizationId: org.id,
        userId: jordan.id,
        title: "Report exported",
        body: "Q2 Customer Health report is ready to download.",
        read: true,
        createdAt: minutesAgo(180),
      },
    ],
  });
  console.log("✓ Notifications created");

  // 8. Create Inventory Seed Data (RF / Electronics Hardware)
  console.log("📦 Creating RF & Electronics Hardware Inventory Seed Data...");

  const catAntennas = await prisma.inventoryCategory.create({
    data: {
      organizationId: org.id,
      name: "Antennas & RF Modules",
      description: "High-gain antennas, RF feeds, and directional arrays",
    },
  });

  const catSemis = await prisma.inventoryCategory.create({
    data: {
      organizationId: org.id,
      name: "Semiconductors & ICs",
      description: "Microcontrollers, RF mixers, and GaN power transistors",
    },
  });

  const catCables = await prisma.inventoryCategory.create({
    data: {
      organizationId: org.id,
      name: "Cables & Connectors",
      description: "Low-loss coaxial cables, SMA, N-type, and BNC connectors",
    },
  });

  const catPower = await prisma.inventoryCategory.create({
    data: {
      organizationId: org.id,
      name: "Power Supplies & Batteries",
      description: "Linear bench supplies, DC-DC converters, and Li-ion battery packs",
    },
  });

  const catSensors = await prisma.inventoryCategory.create({
    data: {
      organizationId: org.id,
      name: "Sensors & Transceivers",
      description: "LoRa nodes, SDR modules, radar detectors, and telemetry kits",
    },
  });

  const catPCBs = await prisma.inventoryCategory.create({
    data: {
      organizationId: org.id,
      name: "PCBs & Development Boards",
      description: "Prototype boards, FPGA evaluation kits, and single-board computers",
    },
  });

  const catNetwork = await prisma.inventoryCategory.create({
    data: {
      organizationId: org.id,
      name: "Networking Equipment",
      description: "Industrial Ethernet switches, PoE injectors, and fiber transceivers",
    },
  });

  const catEnclosures = await prisma.inventoryCategory.create({
    data: {
      organizationId: org.id,
      name: "Enclosures & Mounting Hardware",
      description: "IP67 weatherized enclosures, mast clamps, and DIN rail brackets",
    },
  });

  const locHub = await prisma.inventoryLocation.create({
    data: {
      organizationId: org.id,
      name: "Main Dark Store Hub (Austin)",
      code: "AUS-HUB-01",
      address: "100 Innovation Way, Austin, TX",
      isPrimary: true,
    },
  });

  const locExpress = await prisma.inventoryLocation.create({
    data: {
      organizationId: org.id,
      name: "Express Pod Downtown",
      code: "AUS-EXP-02",
      address: "45 Congress Ave, Austin, TX",
      isPrimary: false,
    },
  });

  const seedNow = new Date();
  const daysFromNow = (days: number) => new Date(seedNow.getTime() + days * 86_400_000);

  const seedItems = [
    // 1. Antennas & RF Modules
    {
      sku: "ANT-58G-DIR",
      name: "5.8GHz Directional Panel Antenna 18dBi",
      categoryId: catAntennas.id,
      unit: "UNITS" as const,
      costPrice: 85.00,
      unitPrice: 149.99,
      reorderPoint: 15,
      targetStock: 60,
      expiryTrackingEnabled: false,
      onHand: 42, // HEALTHY
      description: "Weatherproof high-gain directional antenna for long-range point-to-point links.",
    },
    {
      sku: "ANT-24G-OMNI",
      name: "2.4GHz Omni-Directional Base Antenna 9dBi",
      categoryId: catAntennas.id,
      unit: "UNITS" as const,
      costPrice: 38.00,
      unitPrice: 69.50,
      reorderPoint: 20,
      targetStock: 80,
      expiryTrackingEnabled: false,
      onHand: 12, // LOW (<= 20)
      description: "Fiberglass outdoor omni antenna with integrated N-type female connector.",
    },
    {
      sku: "ANT-915M-YAGI",
      name: "915MHz 8-Element Yagi Array",
      categoryId: catAntennas.id,
      unit: "UNITS" as const,
      costPrice: 52.00,
      unitPrice: 94.00,
      reorderPoint: 10,
      targetStock: 40,
      expiryTrackingEnabled: false,
      onHand: 0, // OUT
      description: "ISM band directional Yagi optimized for telemetry and smart meter backhaul.",
    },
    {
      sku: "RF-AMP-PA50W",
      name: "50W GaN High-Power RF Amplifier Module",
      categoryId: catAntennas.id,
      unit: "UNITS" as const,
      costPrice: 850.00,
      unitPrice: 1380.00,
      reorderPoint: 5,
      targetStock: 20,
      expiryTrackingEnabled: true,
      onHand: 6, // EXPIRING (calibration expires in 20 days)
      expiryDays: 20,
      description: "High-efficiency 2.4-6GHz power amplifier with calibrated thermal protection.",
    },
    {
      sku: "RF-DIP-SDR",
      name: "Dual-Band Cavity Diplexer 1.2/2.4GHz",
      categoryId: catAntennas.id,
      unit: "UNITS" as const,
      costPrice: 120.00,
      unitPrice: 210.00,
      reorderPoint: 8,
      targetStock: 30,
      expiryTrackingEnabled: false,
      onHand: 45, // OVERSTOCKED (> 30)
      description: "Low insertion loss cavity filter for simultaneous multi-channel transmit/receive.",
    },

    // 2. Semiconductors & ICs
    {
      sku: "IC-ESP32-WROOM",
      name: "ESP32-WROOM-32D Dual-Core WiFi/BLE Module",
      categoryId: catSemis.id,
      unit: "PCS" as const,
      costPrice: 2.10,
      unitPrice: 4.85,
      reorderPoint: 100,
      targetStock: 500,
      expiryTrackingEnabled: false,
      onHand: 350, // HEALTHY
      description: "Industry-standard IoT SoC module with PCB antenna and 4MB flash.",
    },
    {
      sku: "IC-STM32F4-MCU",
      name: "STM32F405RG Cortex-M4 Microcontroller LQFP-64",
      categoryId: catSemis.id,
      unit: "PCS" as const,
      costPrice: 6.20,
      unitPrice: 11.50,
      reorderPoint: 50,
      targetStock: 250,
      expiryTrackingEnabled: false,
      onHand: 32, // LOW (<= 50)
      description: "168MHz MCU with DSP, FPU, 1MB flash, and advanced communication interfaces.",
    },
    {
      sku: "IC-LNA-RFMIX",
      name: "Ultra-Low-Noise Preamplifier MMIC 0.1-6GHz",
      categoryId: catSemis.id,
      unit: "PCS" as const,
      costPrice: 14.50,
      unitPrice: 26.00,
      reorderPoint: 40,
      targetStock: 200,
      expiryTrackingEnabled: false,
      onHand: 0, // OUT
      description: "High linearity GaAs PHEMT amplifier with sub-0.8dB noise figure.",
    },
    {
      sku: "IC-LORA-SX1262",
      name: "Semtech SX1262 Sub-GHz LoRa Transceiver IC",
      categoryId: catSemis.id,
      unit: "PCS" as const,
      costPrice: 3.40,
      unitPrice: 6.90,
      reorderPoint: 60,
      targetStock: 300,
      expiryTrackingEnabled: false,
      onHand: 240, // HEALTHY
      description: "+22dBm output power long-range transceiver IC for worldwide ISM bands.",
    },

    // 3. Cables & Connectors
    {
      sku: "CBL-RG58-1M",
      name: "RG58 Low-Loss Coaxial Cable (SMA-Male to SMA-Male 1m)",
      categoryId: catCables.id,
      unit: "PCS" as const,
      costPrice: 6.50,
      unitPrice: 14.99,
      reorderPoint: 25,
      targetStock: 100,
      expiryTrackingEnabled: false,
      onHand: 78, // HEALTHY
      description: "Double-shielded 50-ohm flexible RF jumper cable assembly with gold-plated connectors.",
    },
    {
      sku: "CBL-LMR400-5M",
      name: "LMR-400 Ultra-Low-Loss Feed Cable 5m (N-Male to SMA-Male)",
      categoryId: catCables.id,
      unit: "PCS" as const,
      costPrice: 32.00,
      unitPrice: 59.00,
      reorderPoint: 15,
      targetStock: 50,
      expiryTrackingEnabled: false,
      onHand: 9, // LOW (<= 15)
      description: "Heavy-duty outdoor antenna feeder line with low attenuation up to 6GHz.",
    },
    {
      sku: "CON-SMA-BULK",
      name: "SMA Female to Female Panel-Mount Bulkhead Barrel (10-pack)",
      categoryId: catCables.id,
      unit: "PACKS" as const,
      costPrice: 11.00,
      unitPrice: 22.50,
      reorderPoint: 20,
      targetStock: 80,
      expiryTrackingEnabled: false,
      onHand: 110, // OVERSTOCKED (> 80)
      description: "Precision brass gold-plated chassis adapter with silicone O-ring seal.",
    },
    {
      sku: "CON-N-MALE-CRIMP",
      name: "N-Type Male Clamp Connector for RG213",
      categoryId: catCables.id,
      unit: "PCS" as const,
      costPrice: 4.80,
      unitPrice: 9.75,
      reorderPoint: 30,
      targetStock: 120,
      expiryTrackingEnabled: false,
      onHand: 0, // OUT
      description: "Weather-resistant RF coaxial plug connector rated to 11GHz.",
    },

    // 4. Power Supplies & Batteries
    {
      sku: "PWR-12V5A-DIN",
      name: "12V 5A Industrial DIN-Rail Power Supply 60W",
      categoryId: catPower.id,
      unit: "UNITS" as const,
      costPrice: 24.00,
      unitPrice: 44.90,
      reorderPoint: 12,
      targetStock: 50,
      expiryTrackingEnabled: false,
      onHand: 35, // HEALTHY
      description: "Universal AC input DIN mount supply with short-circuit and over-voltage protection.",
    },
    {
      sku: "BAT-18650-CELL",
      name: "18650 Li-Ion Rechargeable Battery Cell 3500mAh (4-pack)",
      categoryId: catPower.id,
      unit: "PACKS" as const,
      costPrice: 14.00,
      unitPrice: 28.00,
      reorderPoint: 25,
      targetStock: 100,
      expiryTrackingEnabled: true,
      onHand: 18, // EXPIRING (storage expiration in 14 days)
      expiryDays: 14,
      description: "High-capacity grade-A lithium-ion cells for mobile sensor nodes.",
    },
    {
      sku: "PWR-DCDC-STEPDN",
      name: "Wide-Input DC-DC Buck Converter 36V-72V to 12V 10A",
      categoryId: catPower.id,
      unit: "UNITS" as const,
      costPrice: 19.50,
      unitPrice: 38.00,
      reorderPoint: 15,
      targetStock: 60,
      expiryTrackingEnabled: false,
      onHand: 5, // LOW
      description: "Sealed aluminum enclosure converter designed for telecom battery banks.",
    },
    {
      sku: "PWR-POE-INJ30W",
      name: "Gigabit PoE+ Injector 802.3at 30W",
      categoryId: catPower.id,
      unit: "UNITS" as const,
      costPrice: 16.00,
      unitPrice: 31.50,
      reorderPoint: 15,
      targetStock: 60,
      expiryTrackingEnabled: false,
      onHand: 48, // HEALTHY
      description: "Midspan power injector for outdoor access points and IP cameras.",
    },

    // 5. Sensors & Transceivers
    {
      sku: "SNS-LORA-NODE",
      name: "LoRaWAN Environmental Telemetry Node IP67",
      categoryId: catSensors.id,
      unit: "UNITS" as const,
      costPrice: 65.00,
      unitPrice: 119.00,
      reorderPoint: 10,
      targetStock: 40,
      expiryTrackingEnabled: false,
      onHand: 26, // HEALTHY
      description: "Integrated temperature, humidity, pressure, and battery telemetry station.",
    },
    {
      sku: "TRX-SDR-HACKRF",
      name: "Software Defined Radio Transceiver 1MHz-6GHz Kit",
      categoryId: catSensors.id,
      unit: "UNITS" as const,
      costPrice: 180.00,
      unitPrice: 299.00,
      reorderPoint: 6,
      targetStock: 25,
      expiryTrackingEnabled: false,
      onHand: 4, // LOW (<= 6)
      description: "Half-duplex SDR development platform with TCXO clock and telescopic antenna.",
    },
    {
      sku: "SNS-RADAR-24G",
      name: "24GHz FMCW Doppler Radar Velocity Sensor",
      categoryId: catSensors.id,
      unit: "UNITS" as const,
      costPrice: 42.00,
      unitPrice: 79.50,
      reorderPoint: 10,
      targetStock: 40,
      expiryTrackingEnabled: false,
      onHand: 0, // OUT
      description: "Micro-power motion and velocity sensing module with UART / RS485 output.",
    },
    {
      sku: "SNS-PIR-IND",
      name: "Industrial Quad-Element PIR Motion Detector",
      categoryId: catSensors.id,
      unit: "PCS" as const,
      costPrice: 9.20,
      unitPrice: 18.50,
      reorderPoint: 30,
      targetStock: 120,
      expiryTrackingEnabled: false,
      onHand: 85, // HEALTHY
      description: "Hardened perimeter intruder detection sensor with pet immunity.",
    },

    // 6. PCBs & Development Boards
    {
      sku: "DEV-RPI-4B-4G",
      name: "Raspberry Pi 4 Model B (4GB RAM Single Board Computer)",
      categoryId: catPCBs.id,
      unit: "UNITS" as const,
      costPrice: 45.00,
      unitPrice: 65.00,
      reorderPoint: 20,
      targetStock: 80,
      expiryTrackingEnabled: false,
      onHand: 55, // HEALTHY
      description: "Quad-core Cortex-A72 SoC with dual 4K micro-HDMI, Gigabit Ethernet, and USB 3.0.",
    },
    {
      sku: "DEV-FPGA-ARTIX7",
      name: "Xilinx Artix-7 FPGA DSP Evaluation Board",
      categoryId: catPCBs.id,
      unit: "UNITS" as const,
      costPrice: 210.00,
      unitPrice: 349.00,
      reorderPoint: 5,
      targetStock: 20,
      expiryTrackingEnabled: false,
      onHand: 3, // LOW (<= 5)
      description: "100K logic cell FPGA board with DDR3 RAM, FMC connector, and Gigabit Ethernet.",
    },
    {
      sku: "PCB-PROTO-4LAY",
      name: "4-Layer RF Breadboard Prototyping PCB (Pack of 5)",
      categoryId: catPCBs.id,
      unit: "PACKS" as const,
      costPrice: 8.50,
      unitPrice: 17.90,
      reorderPoint: 20,
      targetStock: 80,
      expiryTrackingEnabled: false,
      onHand: 0, // OUT
      description: "Controlled impedance FR4 substrate prototype board with ground plane shielding.",
    },
    {
      sku: "DEV-NUCLEO-144",
      name: "STM32 Nucleo-144 Development Board (F767ZI)",
      categoryId: catPCBs.id,
      unit: "UNITS" as const,
      costPrice: 28.00,
      unitPrice: 48.00,
      reorderPoint: 15,
      targetStock: 60,
      expiryTrackingEnabled: false,
      onHand: 95, // OVERSTOCKED (> 60)
      description: "ARM Cortex-M7 board with on-board ST-LINK debugger and Ethernet PHY.",
    },

    // 7. Networking Equipment
    {
      sku: "NET-SW-POE8",
      name: "8-Port Gigabit Industrial Managed PoE+ Switch",
      categoryId: catNetwork.id,
      unit: "UNITS" as const,
      costPrice: 140.00,
      unitPrice: 235.00,
      reorderPoint: 8,
      targetStock: 30,
      expiryTrackingEnabled: false,
      onHand: 19, // HEALTHY
      description: "Ruggedized fanless DIN-rail switch with 2 SFP fiber uplink ports.",
    },
    {
      sku: "NET-SFP-10G-SR",
      name: "10GBASE-SR SFP+ 850nm Multi-Mode Optical Transceiver",
      categoryId: catNetwork.id,
      unit: "PCS" as const,
      costPrice: 22.00,
      unitPrice: 42.00,
      reorderPoint: 20,
      targetStock: 80,
      expiryTrackingEnabled: false,
      onHand: 14, // LOW (<= 20)
      description: "Hot-pluggable optical transceiver supporting up to 300m link lengths over OM3 fiber.",
    },
    {
      sku: "NET-ROUTER-CELL",
      name: "4G/5G Cellular Gateway Router with Dual SIM & GPS",
      categoryId: catNetwork.id,
      unit: "UNITS" as const,
      costPrice: 260.00,
      unitPrice: 420.00,
      reorderPoint: 5,
      targetStock: 25,
      expiryTrackingEnabled: false,
      onHand: 0, // OUT
      description: "Mission-critical IoT field router with failover IPsec VPN and GPS tracking.",
    },
    {
      sku: "NET-FIBER-LC10M",
      name: "Armored Tactical Fiber Optic Patch Cable 10m (Duplex LC)",
      categoryId: catNetwork.id,
      unit: "PCS" as const,
      costPrice: 18.00,
      unitPrice: 36.00,
      reorderPoint: 15,
      targetStock: 60,
      expiryTrackingEnabled: false,
      onHand: 44, // HEALTHY
      description: "Crush-resistant stainless steel armored multi-mode patch cable.",
    },

    // 8. Enclosures & Mounting Hardware
    {
      sku: "ENC-IP67-ALUM",
      name: "Die-Cast Aluminum Weatherproof Enclosure 220x165x85mm",
      categoryId: catEnclosures.id,
      unit: "UNITS" as const,
      costPrice: 28.00,
      unitPrice: 52.00,
      reorderPoint: 15,
      targetStock: 60,
      expiryTrackingEnabled: false,
      onHand: 38, // HEALTHY
      description: "EMI/RFI shielded waterproof enclosure box with silicone gasket and mounting lugs.",
    },
    {
      sku: "MNT-MAST-CLAMP",
      name: "Heavy-Duty Antenna Mast Mounting Bracket Kit (35-65mm)",
      categoryId: catEnclosures.id,
      unit: "PACKS" as const,
      costPrice: 12.50,
      unitPrice: 24.90,
      reorderPoint: 20,
      targetStock: 80,
      expiryTrackingEnabled: false,
      onHand: 16, // LOW (<= 20)
      description: "Galvanized steel V-jaw clamp bracket for pole, mast, and tower installations.",
    },
    {
      sku: "MNT-DIN-KIT",
      name: "Aluminum DIN-Rail Mounting Clips with Hardware (Pack of 10)",
      categoryId: catEnclosures.id,
      unit: "PACKS" as const,
      costPrice: 7.00,
      unitPrice: 15.00,
      reorderPoint: 25,
      targetStock: 100,
      expiryTrackingEnabled: false,
      onHand: 0, // OUT
      description: "Quick-release spring-loaded 35mm top-hat DIN rail mounting brackets.",
    },
    {
      sku: "ENC-VENT-PLUG",
      name: "Hydrophobic PTFE Pressure Equalization Vent Plug M12",
      categoryId: catEnclosures.id,
      unit: "PCS" as const,
      costPrice: 2.20,
      unitPrice: 5.50,
      reorderPoint: 50,
      targetStock: 200,
      expiryTrackingEnabled: false,
      onHand: 240, // OVERSTOCKED (> 200)
      description: "Breather element that prevents internal condensation and pressure buildup.",
    },
  ];

  for (const s of seedItems) {
    const item = await prisma.inventoryItem.create({
      data: {
        organizationId: org.id,
        sku: s.sku,
        name: s.name,
        categoryId: s.categoryId,
        unit: s.unit,
        costPrice: s.costPrice,
        unitPrice: s.unitPrice,
        reorderPoint: s.reorderPoint,
        targetStock: s.targetStock,
        expiryTrackingEnabled: s.expiryTrackingEnabled,
        description: s.description,
      },
    });

    if (s.onHand > 0) {
      await prisma.inventoryStockLevel.create({
        data: {
          itemId: item.id,
          locationId: locHub.id,
          onHand: s.onHand,
          reserved: 0,
        },
      });

      await prisma.inventoryMovement.create({
        data: {
          organizationId: org.id,
          itemId: item.id,
          locationId: locHub.id,
          type: "RECEIPT",
          quantity: s.onHand,
          reason: "VENDOR_RESTOCK",
          reference: "SEED-INIT-001",
          performedById: jordan.id,
        },
      });

      if (s.expiryTrackingEnabled && s.expiryDays) {
        await prisma.inventoryBatch.create({
          data: {
            itemId: item.id,
            batchCode: `BATCH-${s.sku}-01`,
            quantity: s.onHand,
            expiryDate: daysFromNow(s.expiryDays),
          },
        });
      }
    }
  }
  console.log(`✓ Created ${seedItems.length} RF & Electronics inventory items across 8 categories with initial stock and movements`);

  // 9. RF Admin Console Identity (top-level, intentionally not tenant-scoped)
  //
  // Upsert rather than create: RfAdminUser sits outside every Organization, so
  // the `organization.deleteMany` in step 0 does not cascade to it and a plain
  // create would fail on the second run.
  //
  // The password uses the same unsalted SHA-256 as the client login route,
  // because no password-hashing library is installed in this repository. The RF
  // admin login route has no demo-password fallback, so a real hash is required.
  const rfAdminPasswordHash = createHash("sha256")
    .update(process.env.AUTH_DEMO_PASSWORD ?? "password")
    .digest("hex");

  const rfConsoleAdmin = await prisma.rfAdminUser.upsert({
    where: { email: "admin@rf-intelligence.com" },
    update: {
      name: "RF Console Admin",
      passwordHash: rfAdminPasswordHash,
      isActive: true,
    },
    create: {
      id: "rfa_console_admin",
      name: "RF Console Admin",
      email: "admin@rf-intelligence.com",
      passwordHash: rfAdminPasswordHash,
    },
  });

  // A deactivated console account, so the `isActive` gate in getRfAdminSession
  // has something to reject.
  await prisma.rfAdminUser.upsert({
    where: { email: "suspended@rf-intelligence.com" },
    update: {},
    create: {
      id: "rfa_suspended",
      name: "Suspended RF Console User",
      email: "suspended@rf-intelligence.com",
      passwordHash: rfAdminPasswordHash,
      isActive: false,
    },
  });
  console.log(
    `✓ RF Admin console identity seeded: ${rfConsoleAdmin.email} (sign in via POST /api/auth/rf-admin/login)`,
  );

  // 10. Create Customer Conversations (Part 1)
  const daysAgo = (d: number) => minutesAgo(d * 24 * 60);

  const acmeCustomer = await prisma.customer.create({
    data: {
      id: "cus_acme_vance",
      organizationId: org.id,
      name: "Robert Vance",
      company: "Acme Corp",
      email: "r.vance@acmecorp.com",
      phone: "+1 415 555 0142",
      whatsapp: "+14155550142",
      status: "ACTIVE",
      tagsJson: JSON.stringify(["vip", "wholesale", "renewal-q3"]),
      internalNotes:
        "Prefers WhatsApp. Always confirm dispatch dates by SMS as well. Renewal decision sits with the VP of Operations.",
      orderReference: "SO-ACME-2026-0417 / PO-88213",
      assignedEmployeeId: priya.id,
      lastInteractionAt: minutesAgo(4),
    },
  });

  const meridianCustomer = await prisma.customer.create({
    data: {
      id: "cus_meridian_chen",
      organizationId: org.id,
      name: "Sarah Chen",
      company: "Meridian Health",
      email: "s.chen@meridianhealth.org",
      phone: "+1 617 555 0198",
      whatsapp: null,
      status: "AT_RISK",
      tagsJson: JSON.stringify(["enterprise", "at-risk", "qbr-due"]),
      internalNotes:
        "Two missed shipments in June. Escalate anything touching lead times to the account director before replying.",
      orderReference: "SO-MER-2026-0093",
      assignedEmployeeId: priya.id,
      lastInteractionAt: minutesAgo(37),
    },
  });

  const northstarCustomer = await prisma.customer.create({
    data: {
      id: "cus_northstar_miller",
      organizationId: org.id,
      name: "David Miller",
      company: "Northstar Labs",
      email: "d.miller@northstarlabs.io",
      phone: "+1 206 555 0175",
      whatsapp: null,
      status: "ACTIVE",
      tagsJson: JSON.stringify(["new", "technical"]),
      internalNotes:
        "Evaluating us against two competitors. Send spec sheets ahead of any call.",
      orderReference: null,
      assignedEmployeeId: tom.id,
      lastInteractionAt: minutesAgo(92),
    },
  });

  // Deliberately unassigned: shows what a CLIENT_EMPLOYEE must not see, and
  // gives a CLIENT_ADMIN something they can pick up.
  const globalfinCustomer = await prisma.customer.create({
    data: {
      id: "cus_globalfin_rostova",
      organizationId: org.id,
      name: "Elena Rostova",
      company: "GlobalFin",
      email: "e.rostova@globalfin.com",
      phone: "+44 20 7946 0813",
      whatsapp: "+442079460813",
      status: "ACTIVE",
      tagsJson: JSON.stringify(["enterprise", "unassigned"]),
      internalNotes: "Waiting on an owner — do not reply until assigned.",
      orderReference: "SO-GLF-2026-0211",
      assignedEmployeeId: null,
      lastInteractionAt: minutesAgo(2 * 24 * 60),
    },
  });
  console.log("✓ Demo Customers created (4)");

  await prisma.customerConversation.create({
    data: {
      id: "cusconv_vance_dispatch",
      organizationId: org.id,
      customerId: acmeCustomer.id,
      channel: "WHATSAPP",
      status: "HUMAN_ESCALATION",
      priority: "HIGH",
      subject: "Ships arriving with damaged antenna mounts",
      tagsJson: JSON.stringify(["escalation", "damaged-goods", "logistics"]),
      assignedEmployeeId: priya.id,
      escalationReason:
        "AI flagged a replacement-commitment risk at 0.31 confidence and refused to offer a refund without human sign-off.",
      lastMessageAt: minutesAgo(4),
      lastMessagePreview: "Understood — I will get the replacement arranged today.",
      createdAt: daysAgo(1),
      messages: {
        create: [
          {
            organizationId: org.id,
            sender: "CUSTOMER",
            createdAt: daysAgo(1),
            body: "Hi — the shipment that landed this morning has two bent antenna mounts. We need the mast brackets before the Thursday site install.",
          },
          {
            organizationId: org.id,
            sender: "AI",
            createdAt: daysAgo(1),
            confidenceScore: 0.44,
            body: "Sorry to hear that. I can see order SO-ACME-2026-0417 with 2x MNT-MAST-CLAMP flagged as delivered. I have raised this for a human colleague who can arrange a replacement and will come back to you shortly.",
          },
          {
            organizationId: org.id,
            sender: "EMPLOYEE",
            createdAt: minutesAgo(52),
            body: "Hi Robert, this is Priya from RF Intelligence. I can get replacement clamps out on next-day dispatch — confirming the delivery address is still the Sacramento warehouse?",
          },
          {
            organizationId: org.id,
            sender: "CUSTOMER",
            createdAt: minutesAgo(11),
            body: "Yes, same address. Thursday is very tight for us, so anything you can do helps.",
          },
          {
            organizationId: org.id,
            sender: "EMPLOYEE",
            createdAt: minutesAgo(4),
            body: "Understood — I will get the replacement arranged today.",
          },
        ],
      },
    },
  });

  await prisma.customerConversation.create({
    data: {
      id: "cusconv_chen_leadtime",
      organizationId: org.id,
      customerId: meridianCustomer.id,
      channel: "EMAIL",
      status: "AI_HANDLING",
      priority: "NORMAL",
      subject: "Lead time on the enclosure order",
      tagsJson: JSON.stringify(["lead-time", "qbr"]),
      assignedEmployeeId: priya.id,
      lastMessageAt: minutesAgo(37),
      lastMessagePreview: "Our standard lead time on the IP67 enclosures is 5-7 working days.",
      createdAt: daysAgo(2),
      messages: {
        create: [
          {
            organizationId: org.id,
            sender: "CUSTOMER",
            createdAt: daysAgo(2),
            body: "Following up on the ENC-IP67-ALUM order. Our clinical rollout slipped a week, so we need a firm date. Can you also confirm the price is still the same?",
          },
          {
            organizationId: org.id,
            sender: "AI",
            createdAt: minutesAgo(37),
            confidenceScore: 0.91,
            body: "Hi Sarah, our standard lead time on the IP67 enclosures is 5-7 working days, and the unit price is unchanged at 52.00. Your order is currently allocated against the Melbourne hub with stock available. I have flagged the date question for your account team in case a partial shipment would help.",
          },
        ],
      },
    },
  });

  await prisma.customerConversation.create({
    data: {
      id: "cusconv_miller_specs",
      organizationId: org.id,
      customerId: northstarCustomer.id,
      channel: "WEB_CHAT",
      status: "WAITING_FOR_CUSTOMER",
      priority: "NORMAL",
      subject: "Technical specs for the DIN rail kit",
      tagsJson: JSON.stringify(["technical", "new-business"]),
      assignedEmployeeId: tom.id,
      lastMessageAt: minutesAgo(92),
      lastMessagePreview: "Does the MNT-DIN-KIT work with 35mm top-hat only?",
      createdAt: daysAgo(3),
      messages: {
        create: [
          {
            organizationId: org.id,
            sender: "CUSTOMER",
            createdAt: daysAgo(3),
            body: "Hi — we are evaluating for a new lab build. Can you send the full spec sheet for the MNT-DIN-KIT and the vent plug?",
          },
          {
            organizationId: org.id,
            sender: "AI",
            createdAt: daysAgo(3),
            confidenceScore: 0.88,
            body: "Of course. The MNT-DIN-KIT is a pack of 10 quick-release spring-loaded 35mm top-hat brackets, and the ENC-VENT-PLUG is an M12 hydrophobic PTFE breather for the IP67 enclosures. I have attached both spec sheets.",
          },
          {
            organizationId: org.id,
            sender: "CUSTOMER",
            createdAt: minutesAgo(92),
            body: "Thanks. Does the MNT-DIN-KIT work with 35mm top-hat only? Our existing rails are 35mm but I want to be sure before we size the order.",
          },
        ],
      },
    },
  });

  await prisma.customerConversation.create({
    data: {
      id: "cusconv_rostova_payment",
      organizationId: org.id,
      customerId: globalfinCustomer.id,
      channel: "SMS",
      status: "WAITING_FOR_CLIENT",
      priority: "URGENT",
      subject: "Purchase order reference needed for SO-GLF-2026-0211",
      tagsJson: JSON.stringify(["unassigned", "urgent", "billing"]),
      assignedEmployeeId: null,
      lastMessageAt: minutesAgo(2 * 24 * 60),
      lastMessagePreview: "Could you send the PO number so we can match it to the invoice?",
      createdAt: daysAgo(4),
      messages: {
        create: [
          {
            organizationId: org.id,
            sender: "CUSTOMER",
            createdAt: daysAgo(4),
            body: "Our finance team cannot match the invoice to a purchase order. Could you send the PO number so we can release payment?",
          },
          {
            organizationId: org.id,
            sender: "AI",
            createdAt: minutesAgo(2 * 24 * 60),
            confidenceScore: 0.19,
            body: "I have not been able to confirm the PO number from our records and do not want to guess on an invoice. I am routing this to a human colleague who can pull the original purchase order and come back to you.",
          },
        ],
      },
    },
  });

  await prisma.customerConversation.create({
    data: {
      id: "cusconv_meridian_resolved",
      organizationId: org.id,
      customerId: meridianCustomer.id,
      channel: "WEB_CHAT",
      status: "RESOLVED",
      priority: "LOW",
      subject: "Add a second delivery address to the account",
      tagsJson: JSON.stringify(["account-admin", "closed"]),
      assignedEmployeeId: marcus.id,
      resolvedAt: daysAgo(5),
      closedAt: daysAgo(5),
      lastMessageAt: daysAgo(5),
      lastMessagePreview: "That is all set — the second address is now on the account.",
      createdAt: daysAgo(6),
      messages: {
        create: [
          {
            organizationId: org.id,
            sender: "CUSTOMER",
            createdAt: daysAgo(6),
            body: "Can you add our Cambridge clinic as a second delivery address on the account?",
          },
          {
            organizationId: org.id,
            sender: "AI",
            createdAt: daysAgo(6),
            confidenceScore: 0.83,
            body: "I have sent this to your account team to add the Cambridge clinic as a second delivery address. They will confirm once it is live.",
          },
          {
            organizationId: org.id,
            sender: "EMPLOYEE",
            createdAt: daysAgo(5),
            body: "That is all set — the second address is now on the account.",
          },
        ],
      },
    },
  });

  await prisma.customerConversation.create({
    data: {
      id: "cusconv_acme_closed",
      organizationId: org.id,
      customerId: acmeCustomer.id,
      channel: "EMAIL",
      status: "CLOSED",
      priority: "LOW",
      subject: "Warranty claim on the armored patch cables",
      tagsJson: JSON.stringify(["warranty", "closed"]),
      assignedEmployeeId: marcus.id,
      resolvedAt: daysAgo(9),
      closedAt: daysAgo(8),
      lastMessageAt: daysAgo(8),
      lastMessagePreview: "Replacement cables shipped, tracking shared. Closing this one out.",
      createdAt: daysAgo(10),
      messages: {
        create: [
          {
            organizationId: org.id,
            sender: "CUSTOMER",
            createdAt: daysAgo(10),
            body: "Two of the armored patch cables from the March order are intermittent. Can we claim these under warranty?",
          },
          {
            organizationId: org.id,
            sender: "AI",
            createdAt: daysAgo(10),
            confidenceScore: 0.72,
            body: "That order is within the 24-month warranty window, so this should be covered. I have raised it with a colleague to arrange replacements under warranty.",
          },
          {
            organizationId: org.id,
            sender: "EMPLOYEE",
            createdAt: daysAgo(8),
            body: "Replacement cables shipped, tracking shared. Closing this one out.",
          },
        ],
      },
    },
  });
  console.log("✓ Customer Conversations & Messages created (6 conversations across all 4 channels)");

  console.log("🎉 Database seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
