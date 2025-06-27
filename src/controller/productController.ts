import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { s3Service } from '../services/s3Service';

const prisma = new PrismaClient();

export const createCategory = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const { name, description } = req.body;
    const existing = await prisma.category.findUnique({ where: { name } });
    if (existing) {
      res.status(400).json({ error: 'Category already exists' });
      return;
    }

    const category = await prisma.category.create({
      data: { name, description },
    });

    res.status(201).json({
      message: 'Category created successfully',
      category,
    });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCategories = async (_req: Request, res: Response) => {
  try {
    const categories = await prisma.category.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ categories });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createProduct = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const {
      name,
      description,
      price,
      stock,
      categoryId,
      weight,
      dimensions,
      material,
      warranty,
      features,
    } = req.body;

    const files = req.files as Express.MulterS3.File[];

    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      res.status(400).json({ error: 'Category not found' });
      return;
    }

    const imageUrls = files ? files.map(f => f.location) : [];

    const product = await prisma.product.create({
      data: {
        name,
        description,
        price: parseFloat(price),
        stock: parseInt(stock, 10),
        categoryId,
        images: imageUrls,
      },
    });

    if (weight || dimensions || material || warranty || features) {
      const details: any = {};
      if (weight) details.weight = weight;
      if (dimensions) details.dimensions = dimensions;
      if (material) details.material = material;
      if (warranty) details.warranty = warranty;
      if (features) details.features = JSON.parse(features);

      await prisma.productDetails.upsert({
        where: { productId: product.id },
        update: details,
        create: { productId: product.id, ...details },
      });
    }

    const fullProduct = await prisma.product.findUnique({
      where: { id: product.id },
      include: { category: true, productDetails: true },
    });

    res.status(201).json({
      message: 'Product created successfully',
      product: fullProduct,
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getProducts = async (req: Request, res: Response) => {
  try {
    const {
      page = '1',
      limit = '10',
      category,
      search,
      minPrice,
      maxPrice,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const take = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * take;

    const where: any = { isActive: true };
    if (category) where.categoryId = category;
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = parseFloat(minPrice as string);
      if (maxPrice) where.price.lte = parseFloat(maxPrice as string);
    }

    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder as string;

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { category: true, productDetails: true },
        orderBy,
        skip,
        take,
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      products,
      pagination: {
        page: pageNum,
        limit: take,
        total,
        pages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getProductById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({
      where: { id },
      include: { category: true, productDetails: true },
    });

    if (!product || !product.isActive) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    res.json({ product });
  } catch (error) {
    console.error('Get product by ID error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateProduct = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const { id } = req.params;
    const {
      name,
      description,
      price,
      stock,
      categoryId,
      isActive,
      weight,
      dimensions,
      material,
      warranty,
      features,
    } = req.body;

    const files = req.files as Express.MulterS3.File[];

    const existing = await prisma.product.findUnique({
      where: { id },
      include: { productDetails: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    let images = existing.images;
    if (files && files.length > 0) {
      for (const url of existing.images) {
        const key = url.split('/').pop()!;
        await s3Service.deleteFile(`products/${key}`);
      }
      images = files.map(f => f.location);
    }

    const data: any = {};
    if (name) data.name = name;
    if (description !== undefined) data.description = description;
    if (price) data.price = parseFloat(price);
    if (stock) data.stock = parseInt(stock, 10);
    if (categoryId) data.categoryId = categoryId;
    if (isActive !== undefined) data.isActive = isActive === 'true';
    if (images) data.images = images;

    await prisma.product.update({ where: { id }, data });

    if (weight || dimensions || material || warranty || features) {
      const details: any = {};
      if (weight) details.weight = weight;
      if (dimensions) details.dimensions = dimensions;
      if (material) details.material = material;
      if (warranty) details.warranty = warranty;
      if (features) details.features = JSON.parse(features);

      await prisma.productDetails.upsert({
        where: { productId: id },
        update: details,
        create: { productId: id, ...details },
      });
    }

    const updated = await prisma.product.findUnique({
      where: { id },
      include: { category: true, productDetails: true },
    });

    res.json({
      message: 'Product updated successfully',
      product: updated,
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};