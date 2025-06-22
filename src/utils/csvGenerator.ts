import { Parser } from 'json2csv';
import fs from 'fs';
import path from 'path';

export interface CSVColumn {
  label: string;
  value: string | ((row: any) => any);
}

export class CSVGenerator {
  static generateCSV<T>(data: T[], columns: CSVColumn[]): string {
    try {
      const json2csvParser = new Parser({ fields: columns });
      return json2csvParser.parse(data);
    } catch (error) {
      console.error('CSV generation error:', error);
      throw new Error('Failed to generate CSV');
    }
  }

  static async writeCSVToFile<T>(
    data: T[], 
    columns: CSVColumn[], 
    filename: string,
    directory: string = 'exports'
  ): Promise<string> {
    try {
      const csv = this.generateCSV(data, columns);
      
      // Ensure directory exists
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }

      const filePath = path.join(directory, filename);
      fs.writeFileSync(filePath, csv);
      
      return filePath;
    } catch (error) {
      console.error('CSV file write error:', error);
      throw new Error('Failed to write CSV file');
    }
  }

  static getProductCSVColumns(): CSVColumn[] {
    return [
      { label: 'Product ID', value: 'id' },
      { label: 'Name', value: 'name' },
      { label: 'Description', value: 'description' },
      { label: 'Price (₹)', value: 'price' },
      { label: 'Stock', value: 'stock' },
      { label: 'Category', value: 'category.name' },
      { label: 'Status', value: (row) => row.isActive ? 'Active' : 'Inactive' },
      { label: 'Created At', value: (row) => new Date(row.createdAt).toLocaleDateString() },
    ];
  }

  static getOrderCSVColumns(): CSVColumn[] {
    return [
      { label: 'Order ID', value: 'id' },
      { label: 'Customer', value: 'user.name' },
      { label: 'Total Amount (₹)', value: 'totalAmount' },
      { label: 'Payment Status', value: 'paymentStatus' },
      { label: 'Delivery Status', value: 'deliveryStatus' },
      { label: 'Payment Method', value: 'paymentMethod' },
      { label: 'Order Date', value: (row) => new Date(row.createdAt).toLocaleDateString() },
      { label: 'City', value: 'shippingAddress.city' },
      { label: 'State', value: 'shippingAddress.state' },
    ];
  }

  static getUserCSVColumns(): CSVColumn[] {
    return [
      { label: 'User ID', value: 'id' },
      { label: 'Name', value: 'name' },
      { label: 'Username', value: 'username' },
      { label: 'Email', value: 'userDetails.email' },
      { label: 'Phone', value: 'userDetails.phone' },
      { label: 'City', value: 'userDetails.city' },
      { label: 'State', value: 'userDetails.state' },
      { label: 'Registered Date', value: (row) => new Date(row.createdAt).toLocaleDateString() },
      { label: 'Total Orders', value: (row) => row.orders?.length || 0 },
    ];
  }

  static getCategoryCSVColumns(): CSVColumn[] {
    return [
      { label: 'Category ID', value: 'id' },
      { label: 'Name', value: 'name' },
      { label: 'Description', value: 'description' },
      { label: 'Total Products', value: (row) => row.products?.length || 0 },
      { label: 'Created At', value: (row) => new Date(row.createdAt).toLocaleDateString() },
    ];
  }
}