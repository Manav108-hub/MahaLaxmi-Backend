  import { Request, Response } from 'express';
  import { validationResult } from 'express-validator';
  import { PrismaClient, Prisma } from '@prisma/client';
  import { s3Service } from '../services/s3Service';
  import slugify from 'slugify';

  const prisma = new PrismaClient();

  // Helper function for consistent error responses
  const errorResponse = (res: Response, status: number, message: string) => {
    return res.status(status).json({
      success: false,
      error: message
    });
  };

  // Use Prisma generated types instead of custom interfaces
  type ProductCreateInput = Prisma.ProductCreateInput;
  type ProductUpdateInput = Prisma.ProductUpdateInput;

  export const createCategory = async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return errorResponse(res, 400, errors.array()[0].msg);
    }

    try {
      const { name, description } = req.body;

      const existing = await prisma.category.findUnique({ where: { name } });
      if (existing) {
        return errorResponse(res, 400, 'Category already exists');
      }

      const category = await prisma.category.create({
        data: { name, description },
      });

      return res.status(201).json({
        success: true,
        message: 'Category created successfully',
        data: category
      });
    } catch (error) {
      console.error('Create category error:', error);
      return errorResponse(res, 500, 'Internal server error');
    }
  };

  export const getCategories = async (req: Request, res: Response) => {
    try {
      const categories = await prisma.category.findMany({
        include: { _count: { select: { products: true } } },
        orderBy: { name: 'asc' },
      });
      return res.json({
        success: true,
        data: categories
      });
    } catch (error) {
      console.error('Get categories error:', error);
      return errorResponse(res, 500, 'Internal server error');
    }
  };

  export const createProduct = async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return errorResponse(res, 400, errors.array()[0].msg);
    }

    try {
      const { name, description, price, stock, categoryId } = req.body;
      const files = req.files as Express.MulterS3.File[];

      // Validate category existence
      const category = await prisma.category.findUnique({
        where: { id: categoryId }
      });
      if (!category) {
        return errorResponse(res, 400, 'Category not found');
      }

      // Generate unique slug
      const baseSlug = slugify(name, {
        lower: true,
        strict: true,
        remove: /[*+~.()'"!:@]/g
      });

      let uniqueSlug = baseSlug;
      let counter = 1;

      while (await prisma.product.findUnique({ where: { slug: uniqueSlug } })) {
        uniqueSlug = `${baseSlug}-${counter}`;
        counter++;
      }

      const slug = uniqueSlug;
      const images = files?.map(f => f.location) || [];
      const isActive = true;

      // Create product
      const product = await prisma.product.create({
        data: {
          name,
          description,
          price: parseFloat(price),
          stock: parseInt(stock, 10),
          slug,
          images,
          isActive,
          category: {
            connect: { id: categoryId }
          }
        },
        include: {
          category: true,
          productDetails: true
        }
      });

      return res.status(201).json({
        success: true,
        message: 'Product created successfully',
        data: product
      });
    } catch (error) {
      console.error('Create product error:', error);
      return errorResponse(res, 500, 'Internal server error');
    }
  };


  export const getProductBySlug = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    console.log('Fetching product with slug:', slug); // Add this line

    if (!slug) {
      return errorResponse(res, 400, 'Slug is required');
    }

    const product = await prisma.product.findUnique({
      where: { slug },
      include: { 
        category: true,
        productDetails: true
      }
    });

    console.log('Found product:', product); // Add this line

    if (!product || !product.isActive) {
      return errorResponse(res, 404, 'Product not found');
    }

    return res.json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Get product by slug error:', error);
    return errorResponse(res, 500, 'Internal server error');
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

      // Parse pagination parameters
      const pageNum = Math.max(1, parseInt(page as string, 10));
      const take = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
      const skip = (pageNum - 1) * take;

      // Build query filters using Prisma's WhereInput type
      const where: Prisma.ProductWhereInput = { isActive: true };

      if (category) where.categoryId = category as string;

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

      // Build orderBy using Prisma's OrderByInput type
      const orderBy: Prisma.ProductOrderByWithRelationInput = {
        [sortBy as string]: sortOrder as 'asc' | 'desc'
      };

      // Execute query
      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: {
            category: true,
            productDetails: true
          },
          orderBy,
          skip,
          take,
        }),
        prisma.product.count({ where }),
      ]);

      return res.json({
        success: true,
        data: {
          products,
          pagination: {
            page: pageNum,
            limit: take,
            total,
            pages: Math.ceil(total / take),
          },
        }
      });
    } catch (error) {
      console.error('Get products error:', error);
      return errorResponse(res, 500, 'Internal server error');
    }
  };

  export const getProductById = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Check if it's a valid ObjectID (24 char hex string)
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);

      let product;

      if (isObjectId) {
        // Query by ID
        product = await prisma.product.findUnique({
          where: { id },
          include: {
            category: true,
            productDetails: true
          },
        });
      } else {
        // Query by slug
        product = await prisma.product.findUnique({
          where: {
            slug: id
          },
          include: {
            category: true,
            productDetails: true
          }
        });
      }

      if (!product || !product.isActive) {
        return errorResponse(res, 404, 'Product not found');
      }

      return res.json({
        success: true,
        data: product
      });
    } catch (error) {
      console.error('Get product error:', error);
      return errorResponse(res, 500, 'Internal server error');
    }
  };

  export const updateProduct = async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return errorResponse(res, 400, errors.array()[0].msg);
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

      // Verify product exists
      const existing = await prisma.product.findUnique({
        where: { id },
        include: { productDetails: true },
      });

      if (!existing) {
        return errorResponse(res, 404, 'Product not found');
      }

      // Handle image updates
      let images = existing.images;
      if (files && files.length > 0) {
        // Delete old images from S3
        await Promise.all(
          existing.images.map(async (url) => {
            const key = url.split('/').pop()!;
            return s3Service.deleteFile(`products/${key}`);
          })
        );
        images = files.map(f => f.location);
      }

      // Generate new slug if name is being updated
      let slug = existing.slug;
      if (name && name !== existing.name) {
        const baseSlug = slugify(name, {
          lower: true,
          strict: true,
          remove: /[*+~.()'"!:@]/g
        });

        let uniqueSlug = baseSlug;
        let counter = 1;

        while (true) {
          const existingProduct = await prisma.product.findUnique({
            where: { slug: uniqueSlug }
          });

          if (!existingProduct || existingProduct.id === id) break;

          uniqueSlug = `${baseSlug}-${counter}`;
          counter++;
        }
        slug = uniqueSlug;
      }

      // Prepare update data using Prisma's generated types
      const updateData: Prisma.ProductUpdateInput = {};
      if (name) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (price) updateData.price = parseFloat(price);
      if (stock) updateData.stock = parseInt(stock, 10);
      if (categoryId) updateData.category = categoryId;
      if (isActive !== undefined) updateData.isActive = isActive === 'true';
      if (images) updateData.images = images;
      if (slug !== existing.slug) updateData.slug = slug;

      // Update product
      await prisma.product.update({
        where: { id },
        data: updateData
      });

      // Handle product details
      if (weight || dimensions || material || warranty || features) {
        const detailsData: Prisma.ProductDetailsUpdateInput = {};
        if (weight) detailsData.weight = weight;
        if (dimensions) detailsData.dimensions = dimensions;
        if (material) detailsData.material = material;
        if (warranty) detailsData.warranty = warranty;
        if (features) detailsData.features = JSON.parse(features);

        await prisma.productDetails.upsert({
          where: { productId: id },
          update: detailsData,
          create: {
            productId: id,
            weight: weight || null,
            dimensions: dimensions || null,
            material: material || null,
            warranty: warranty || null,
            features: features ? JSON.parse(features) : []
          },
        });
      }

      // Fetch updated product
      const updated = await prisma.product.findUnique({
        where: { id },
        include: {
          category: true,
          productDetails: true
        },
      });

      return res.json({
        success: true,
        message: 'Product updated successfully',
        data: updated,
      });
    } catch (error) {
      console.error('Update product error:', error);
      return errorResponse(res, 500, 'Internal server error');
    }
  };