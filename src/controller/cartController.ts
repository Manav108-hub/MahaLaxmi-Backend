import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const addToCart = async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { productId, quantity } = req.body;
    const userId = req.user!.id;

    const product = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product || !product.isActive) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (product.stock < quantity) {
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    const existingCartItem = await prisma.cart.findUnique({
      where: {
        userId_productId: {
          userId,
          productId
        }
      }
    });

    let cartItem;
    if (existingCartItem) {
      const newQuantity = existingCartItem.quantity + quantity;
      
      if (product.stock < newQuantity) {
        return res.status(400).json({ error: 'Insufficient stock for requested quantity' });
      }

      cartItem = await prisma.cart.update({
        where: { id: existingCartItem.id },
        data: { quantity: newQuantity },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              price: true,
              images: true,
              stock: true
            }
          }
        }
      });
    } else {
      cartItem = await prisma.cart.create({
        data: {
          userId,
          productId,
          quantity
        },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              price: true,
              images: true,
              stock: true
            }
          }
        }
      });
    }

    res.status(201).json({
      message: 'Item added to cart successfully',
      cartItem
    });
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCart = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const cartItems = await prisma.cart.findMany({
      where: { userId },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            price: true,
            images: true,
            stock: true,
            isActive: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const activeCartItems = cartItems.filter(item => item.product.isActive);
    const totalItems = activeCartItems.reduce((sum, item) => sum + item.quantity, 0);
    const totalAmount = activeCartItems.reduce(
      (sum, item) => sum + (item.product.price * item.quantity), 
      0
    );

    res.json({
      cartItems: activeCartItems,
      summary: {
        totalItems,
        totalAmount: parseFloat(totalAmount.toFixed(2))
      }
    });
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateCartItem = async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { itemId } = req.params;
    const { quantity } = req.body;
    const userId = req.user!.id;

    const cartItem = await prisma.cart.findUnique({
      where: { id: itemId },
      include: { product: true }
    });

    if (!cartItem || cartItem.userId !== userId) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    if (cartItem.product.stock < quantity) {
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    const updatedCartItem = await prisma.cart.update({
      where: { id: itemId },
      data: { quantity },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            price: true,
            images: true,
            stock: true
          }
        }
      }
    });

    res.json({
      message: 'Cart item updated successfully',
      cartItem: updatedCartItem
    });
  } catch (error) {
    console.error('Update cart item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const removeFromCart = async (req: Request, res: Response) => {
  try {
    const { itemId } = req.params;
    const userId = req.user!.id;

    const cartItem = await prisma.cart.findUnique({
      where: { id: itemId }
    });

    if (!cartItem || cartItem.userId !== userId) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    await prisma.cart.delete({
      where: { id: itemId }
    });

    res.json({ message: 'Item removed from cart successfully' });
  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSelectedCartItems = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { cartItemIds } = req.body;
  const userId = req.user!.id;

  const items = await prisma.cart.findMany({
    where: { userId, id: { in: cartItemIds } },
    include: {
      product: {
        select: { 
          id: true, 
          name: true, 
          price: true, 
          images: true, 
          stock: true, 
          isActive: true 
        }
      }
    }
  });

  if (items.length !== cartItemIds.length) {
    return res.status(400).json({ error: 'Some items not found in your cart' });
  }

  const inactive = items.filter(i => !i.product.isActive);
  if (inactive.length) {
    return res.status(400).json({
      error: `Unavailable: ${inactive.map(i => i.product.name).join(', ')}`
    });
  }

  const oos = items.filter(i => i.product.stock < i.quantity);
  if (oos.length) {
    return res.status(400).json({
      error: `Insufficient stock: ${oos.map(i => i.product.name).join(', ')}`
    });
  }

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalAmount = items.reduce(
    (sum, i) => sum + (i.quantity * i.product.price), 
    0
  );

  res.json({
    cartItems: items,
    summary: {
      selectedItemsCount: items.length,
      totalItems,
      totalAmount: parseFloat(totalAmount.toFixed(2))
    }
  });
};