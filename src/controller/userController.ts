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

export const getAllUsers = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 10, search } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
        const take = parseInt(limit as string);

        const where: any = {};
        if (search) {
            where.OR = [
                { name: { contains: search as string, mode: 'insensitive' } },
                { username: { contains: search as string, mode: 'insensitive' } },
                { userDetails: { email: { contains: search as string, mode: 'insensitive' } } }
            ];
        }

        const [users, totalCount] = await Promise.all([
            prisma.user.findMany({
                where,
                include: { 
                    userDetails: true,
                    _count: {
                        select: {
                            orders: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take
            }),
            prisma.user.count({ where })
        ]);

        // Calculate additional stats for each user
        const usersWithStats = await Promise.all(
            users.map(async (user) => {
                const orderStats = await prisma.order.aggregate({
                    where: { userId: user.id },
                    _sum: { totalAmount: true },
                    _count: true
                });

                return {
                    ...user,
                    totalOrders: orderStats._count || 0,
                    totalSpent: orderStats._sum.totalAmount || 0,
                    // Flatten userDetails
                    email: user.userDetails?.email,
                    phone: user.userDetails?.phone,
                    address: user.userDetails?.address,
                    city: user.userDetails?.city,
                    state: user.userDetails?.state,
                    pincode: user.userDetails?.pincode,
                };
            })
        );

        res.json({
            success: true,
            users: usersWithStats,
            pagination: {
                page: parseInt(page as string),
                limit: take,
                total: totalCount,
                pages: Math.ceil(totalCount / take)
            }
        });
    } catch (error) {
        console.error('Get all users error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getUserById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            include: { 
                userDetails: true,
                orders: {
                    include: {
                        orderItems: {
                            include: { product: true }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Calculate user statistics
        const totalSpent = user.orders.reduce((sum, order) => sum + order.totalAmount, 0);
        const totalOrders = user.orders.length;

        const responseUser = {
            ...user,
            email: user.userDetails?.email,
            phone: user.userDetails?.phone,
            address: user.userDetails?.address,
            city: user.userDetails?.city,
            state: user.userDetails?.state,
            pincode: user.userDetails?.pincode,
            totalOrders,
            totalSpent,
        };

        res.json({
            success: true,
            user: responseUser
        });
    } catch (error) {
        console.error('Get user by ID error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteUser = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Check if user exists
        const user = await prisma.user.findUnique({
            where: { id }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Delete user details first (if exists)
        await prisma.userDetails.deleteMany({
            where: { userId: id }
        });

        // Delete user
        await prisma.user.delete({
            where: { id }
        });

        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getUserStats = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const [orderStats, firstOrder, lastOrder] = await Promise.all([
            prisma.order.aggregate({
                where: { userId: id },
                _sum: { totalAmount: true },
                _count: true
            }),
            prisma.order.findFirst({
                where: { userId: id },
                orderBy: { createdAt: 'asc' }
            }),
            prisma.order.findFirst({
                where: { userId: id },
                orderBy: { createdAt: 'desc' }
            })
        ]);

        res.json({
            success: true,
            data: {
                totalOrders: orderStats._count || 0,
                totalSpent: orderStats._sum.totalAmount || 0,
                firstOrderDate: firstOrder?.createdAt || null,
                lastOrderDate: lastOrder?.createdAt || null
            }
        });
    } catch (error) {
        console.error('Get user stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateUser = async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { id } = req.params;
        const { name, username, isAdmin, email, phone, address, city, state, pincode } = req.body;

        // Update user basic info
        const updatedUser = await prisma.user.update({
            where: { id },
            data: { name, username, isAdmin },
            include: { userDetails: true }
        });

        // Update user details if provided
        if (email || phone || address || city || state || pincode) {
            await prisma.userDetails.upsert({
                where: { userId: id },
                update: { email, phone, address, city, state, pincode },
                create: { userId: id, email, phone, address, city, state, pincode }
            });
        }

        // Get the complete updated user
        const user = await prisma.user.findUnique({
            where: { id },
            include: { userDetails: true }
        });

        res.json({
            success: true,
            message: 'User updated successfully',
            user: {
                ...user,
                email: user?.userDetails?.email,
                phone: user?.userDetails?.phone,
                address: user?.userDetails?.address,
                city: user?.userDetails?.city,
                state: user?.userDetails?.state,
                pincode: user?.userDetails?.pincode,
            }
        });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};