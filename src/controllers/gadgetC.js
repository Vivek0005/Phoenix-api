const generateCodename = require("../../utils/codeNameGenerator");
const generateProbabilty = require("../../utils/randomProbabilityGen");
const validStatuses = require("../../utils/validStatus");
const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();

exports.getAllGadgets = async (req, res) => {
    try {
        const { status } = req.query;
        let whereClause = {};

        if (status) {
            if (!validStatuses.includes(status)) {
                return res.status(400).json({ message: `Invalid status. Allowed statuses: ${validStatuses.join(", ")}` });
            }
            whereClause.status = status;
        }

        const gadgets = await prisma.gadget.findMany({ where: whereClause });

        if (gadgets.length === 0) {
            return res.status(404).json({ message: `No gadgets found with status : ${status}` });
        }

        const response = gadgets.map(gadget => ({
            ...gadget,
            successRate: generateProbabilty()
        }));

        res.json(response);
    } catch (error) {
        console.error("Error fetching gadgets:", error);
        res.status(500).json({ message: "Failed to retrieve gadgets due to internal server error" });
    }
};

exports.getGadgetById = async (req, res) => {
    try {
        const gadgetId = req.params.id;

        const gadget = await prisma.gadget.findUnique({ where: { id: gadgetId } });

        if (!gadget) {
            return res.status(404).json({ message: `Gadget with id ${gadgetId} not found` });
        }

        res.json(gadget);
    } catch (error) {
        console.error("Error fetching gadget:", error);
        res.status(500).json({ message: "Failed to retrieve gadget due to internal server error" });
    }
};

exports.createGadget = async (req, res) => {
    try {
        const { status } = req.body;

        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({ message: `Invalid status value. Allowed values are: ${validStatuses.join(", ")}` });
        }

        const data = {
            name: generateCodename(),
            status: status || "Available",

            ...(status === "Decommissioned" && { decommissionedAt: new Date() }),
        };

        const newGadget = await prisma.gadget.create({ data });

        console.log("Gadget successfully created");
        res.status(201).json(newGadget);
    } catch (error) {
        console.log("Error creating gadget : ", error);
        res.status(500).json({ message: "Failed to create gadget due to internal server error" });
    }
};

exports.updateGadget = async (req, res) => {
    try {
        const gadgetId = req.params.id;
        const { name, status } = req.body;

        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({
                message: `Invalid status value. Allowed values are: ${validStatuses.join(", ")}`
            });
        }

        const updatedGadget = await prisma.gadget.update({
            where: { id: gadgetId },
            data: {
                ...(name && { name }),
                ...(status && { status })
            }
        });

        console.log("Gadget details modified successfully");
        res.json(updatedGadget);
    } catch (error) {
        console.error("Error updating gadget:", error);
        res.status(500).json({ message: "Failed to update gadget" });
    }
};

exports.decommissionGadget = async (req, res) => {
    try {
        const gadgetId = req.params.id;

        const gadget = await prisma.gadget.findUnique({ where: { id: gadgetId } });

        if (!gadget) {
            return res.status(404).json({ message: `Gadget with id ${gadgetId} not found` });
        }

        if (gadget.status === "Decommissioned") {
            return res.status(400).json({ message: "Gadget is already decommissioned" });
        }

        await prisma.gadget.update({
            where: { id: gadgetId },
            data: {
                status: "Decommissioned",
                decommissionedAt: new Date()
            }
        });

        res.status(201).json({ message: `Gadget ${gadget.name} successfully decommissioned` });
    } catch (error) {
        console.error("Error decommissioning gadget:", error);
        res.status(500).json({ message: "Failed to decommission gadget" });
    }
};

exports.selfDestruct = async (req, res) => {
    try {
        const gadgetId = req.params.id;

        const gadget = await prisma.gadget.findUnique({ where: { id: gadgetId } });

        if (!gadget) {
            return res.status(404).json({ message: `Gadget with id ${gadgetId} not found` });
        }

        const confirmationCode = `DESTRUCT-IMF-${Math.floor(1000 + Math.random() * 90000)}`;

        res.json({
            message: `SelfDSestruct sequence initiated for ${gadget.name}`,
            confirmationCode
        });
    } catch (error) {
        console.error("Error initiating self-destruct:", error);
        res.status(500).json({ message: "Failed to initiate self-destruct sequence" });
    }
};
