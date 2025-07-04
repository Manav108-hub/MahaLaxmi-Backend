import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { Parser } from 'json2csv';

const prisma = new PrismaClient();

export const getUserProfile = async (req: Request, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.id },
            include: { userDetails: true }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Merge user and userDetails
        const responseUser = {
            ...user,
            ...user.userDetails,
            userDetails: undefined // Remove the nested object
        };

        res.json({ 
            success: true,
            data: {
                user: responseUser
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateUserDetails = async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, phone, address, city, state, pincode } = req.body;
        const userId = req.user!.id;

        // Update or create user details
        const userDetails = await prisma.userDetails.upsert({
            where: { userId },
            update: { email, phone, address, city, state, pincode },
            create: { userId, email, phone, address, city, state, pincode }
        });

        // Get the full updated user object
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { userDetails: true }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Merge user and userDetails into a single object
        const responseUser = {
            ...user,
            ...user.userDetails,
            userDetails: undefined // Remove the nested userDetails
        };

        res.json({
            success: true,
            data: {
                user: responseUser
            }
        });
    } catch (error) {
        console.error('Update user details error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const downloadUsersCSV = async (req: Request, res: Response) => {
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                name: true,
                username: true,
                isAdmin: true,
                createdAt: true,
                userDetails: {
                    select: {
                        email: true,
                        phone: true,
                        address: true,
                        city: true,
                        state: true,
                        pincode: true
                    }
                }
            }
        });

        const flattenedUsers = users.map(user => ({
            id: user.id,
            name: user.name,
            username: user.username,
            isAdmin: user.isAdmin,
            createdAt: user.createdAt,
            email: user.userDetails?.email || '',
            phone: user.userDetails?.phone || '',
            address: user.userDetails?.address || '',
            city: user.userDetails?.city || '',
            state: user.userDetails?.state || '',
            pincode: user.userDetails?.pincode || ''
        }));

        const fields = [
            'id', 'name', 'username', 'isAdmin', 'createdAt',
            'email', 'phone', 'address', 'city', 'state', 'pincode'
        ];

        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(flattenedUsers);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
        res.send(csv);
    } catch (error) {
        console.error('Download users CSV error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};