import * as Express from 'express';
import { Collections, logger, ServiceError } from '@microrealestate/common';
import {
  CollectionTypes,
  MongooseDocument,
  TenantAPI,
  UserServicePrincipal
} from '@microrealestate/types';
import moment from 'moment';

// Email validation regex - RFC 5322 compliant, stricter version
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Validates and sanitizes email input to prevent injection attacks
 * @param email - The email string to validate
 * @returns Sanitized email or throws error if invalid
 */
function validateAndSanitizeEmail(email: string): string {
  if (!email || typeof email !== 'string') {
    throw new ServiceError('Invalid email format', 400);
  }

  // Trim and convert to lowercase
  const sanitizedEmail = email.trim().toLowerCase();

  // Check for maximum length to prevent DoS
  if (sanitizedEmail.length > 254) {
    throw new ServiceError('Email too long', 400);
  }

  // Additional security checks for malformed emails
  if (
    sanitizedEmail.includes('..') ||
    sanitizedEmail.startsWith('.') ||
    sanitizedEmail.endsWith('.') ||
    sanitizedEmail.includes('@.') ||
    sanitizedEmail.includes('.@')
  ) {
    throw new ServiceError('Invalid email format', 400);
  }

  // Validate email format with regex
  if (!EMAIL_REGEX.test(sanitizedEmail)) {
    throw new ServiceError('Invalid email format', 400);
  }

  return sanitizedEmail;
}

export async function getOneTenant(
  request: Express.Request,
  response: Express.Response
) {
  const req = request as TenantAPI.GetOneTenant.Request;
  const res = response as TenantAPI.GetOneTenant.Response;
  const user = req.user as UserServicePrincipal;
  const email = user.email;
  const phone = user.phone;

  if (!email && !phone) {
    logger.error('missing email or phone field');
    throw new ServiceError('unauthorized', 401);
  }

  const tenantId = req.params.tenantId;

  // Validate tenantId format (MongoDB ObjectId)
  if (!tenantId || !/^[0-9a-fA-F]{24}$/.test(tenantId)) {
    throw new ServiceError('Invalid tenant ID format', 400);
  }

  const query: Record<string, unknown> = { _id: tenantId };

  // Build query based on available authentication method
  if (email && !email.includes('@whatsapp.tenant')) {
    // Email-based authentication
    const sanitizedEmail = validateAndSanitizeEmail(email);
    query['contacts.email'] = sanitizedEmail;
  } else if (phone) {
    // Phone-based authentication (WhatsApp)
    query.$or = [
      { 'contacts.phone': phone },
      { 'contacts.phone1': phone },
      { 'contacts.phone2': phone }
    ];
  } else {
    throw new ServiceError('unauthorized', 401);
  }

  const dbTenant = await Collections.Tenant.findOne<
    MongooseDocument<CollectionTypes.Tenant>
  >(query).populate<{
    realmId: CollectionTypes.Realm;
    leaseId: CollectionTypes.Lease;
  }>(['realmId', 'leaseId']);

  if (!dbTenant) {
    throw new ServiceError('tenant not found', 404);
  }

  const now = moment();
  const lastTerm = Number(now.format('YYYYMMDDHH'));

  res.json({
    results: [_toTenantResponse(dbTenant, lastTerm)]
  });
}

export async function getAllTenants(
  request: Express.Request,
  response: Express.Response
) {
  const req = request as TenantAPI.GetAllTenants.Request;
  const res = response as TenantAPI.GetAllTenants.Response;
  const user = req.user as UserServicePrincipal;
  const email = user.email;
  const phone = user.phone;

  if (!email && !phone) {
    logger.error('missing email or phone field');
    throw new ServiceError('unauthorized', 401);
  }

  const query: Record<string, unknown> = {};

  // Build query based on available authentication method
  if (email && !email.includes('@whatsapp.tenant')) {
    // Email-based authentication
    const sanitizedEmail = validateAndSanitizeEmail(email);
    query['contacts.email'] = sanitizedEmail;
  } else if (phone) {
    // Phone-based authentication (WhatsApp)
    query.$or = [
      { 'contacts.phone': phone },
      { 'contacts.phone1': phone },
      { 'contacts.phone2': phone }
    ];
  } else {
    throw new ServiceError('unauthorized', 401);
  }

  const dbTenants = await Collections.Tenant.find<
    MongooseDocument<CollectionTypes.Tenant>
  >(query).populate<{
    realmId: CollectionTypes.Realm;
    leaseId: CollectionTypes.Lease;
  }>(['realmId', 'leaseId']);

  // If no tenants found or no lease associated, return a specific response
  if (!dbTenants.length || dbTenants.some((tenant) => !tenant.leaseId)) {
    return res.status(404).json({
      status: 'no_contract',
      message: 'No contract associated with this account'
    });
  }

  // the last term considering the current date
  const lastTerm = Number(moment().format('YYYYMMDDHH'));

  res.json({
    results: dbTenants.map((tenant) => _toTenantResponse(tenant, lastTerm))
  });
}

function _toTenantResponse(
  tenant: CollectionTypes.Tenant,
  lastTerm: number
): TenantAPI.TenantDataType {
  const now = moment();
  const firstRent = tenant.rents?.[0];
  const totalPreTaxAmount = firstRent?.total.preTaxAmount || 0;
  const totalChargesAmount = firstRent?.total.charges || 0;
  const totalVatAmount = firstRent?.total.vat || 0;
  const totalAmount = totalPreTaxAmount + totalChargesAmount + totalVatAmount;

  // Check if lease exists before computing remaining iterations
  const lease = tenant.leaseId as CollectionTypes.Lease;
  const { remainingIterations, remainingIterationsToPay } = lease
    ? _computeRemainingIterations(tenant, lastTerm, totalAmount)
    : { remainingIterations: 0, remainingIterationsToPay: 0 };

  const landlord = tenant.realmId as CollectionTypes.Realm;

  return {
    tenant: {
      id: tenant._id,
      name: tenant.name,
      contacts: tenant.contacts.map((contact) => ({
        name: contact.contact,
        email: contact.email,
        phone1: contact.phone
      })),
      addresses: [
        {
          street1: tenant.street1,
          street2: tenant.street2,
          zipCode: tenant.zipCode,
          city: tenant.city,
          state: '',
          country: ''
        }
      ]
    },
    landlord: {
      name: landlord?.name || '',
      addresses: landlord?.addresses || [],
      contacts: landlord?.contacts || [],
      currency: landlord?.currency || 'USD',
      locale: landlord?.locale || 'en'
    },
    lease: {
      name: lease?.name || 'No contract',
      beginDate: tenant.beginDate,
      endDate: tenant.endDate,
      terminationDate: tenant.terminationDate,
      timeRange: lease?.timeRange || 'month',
      status: tenant.terminationDate
        ? 'terminated'
        : moment(tenant.endDate, 'YYYY-MM-DD').isBefore(now)
          ? 'ended'
          : 'active',
      rent: {
        totalPreTaxAmount,
        totalChargesAmount,
        totalVatAmount,
        totalAmount
      },
      remainingIterations,
      remainingIterationsToPay,
      properties:
        tenant.properties?.map((property) => ({
          id: property.property._id,
          name: property.property.name,
          description: property.property.description,
          type: property.property.type
        })) || [],
      documents: [],
      // tenant.leaseId.documents.map((document) => ({
      //   name: document.name,
      //   description: document.description,
      //   url: document.url,
      // })),
      invoices: tenant.rents
        ?.filter(({ term }) => term <= lastTerm)
        .sort((r1, r2) => r2.term - r1.term)
        .map((rent) => {
          return {
            id: `${tenant._id}-${rent.term}`,
            term: rent.term,
            balance: rent.total.balance,
            grandTotal: rent.total.grandTotal,
            payment: rent.total.payment || 0,
            methods: rent.payments
              .filter((payment) => !!payment)
              .map((payment) => payment.type),
            status:
              rent.total.grandTotal - (rent.total.payment || 0) <= 0
                ? 'paid'
                : rent.total.payment > 0
                  ? 'partially-paid'
                  : 'unpaid',
            payments:
              rent.payments.map((payment) => ({
                date: payment.date,
                method: payment.type,
                reference: payment.reference,
                amount: payment.amount || 0
              })) || []
          };
        }),
      balance: _computeBalance(tenant.rents, lastTerm),
      deposit: tenant.guaranty - tenant.guarantyPayback
    }
  };
}

function _computeRemainingIterations(
  tenant: CollectionTypes.Tenant,
  lastTerm: number,
  rentAmount: number
) {
  // Check if leaseId exists and has timeRange property
  const lease = tenant.leaseId as CollectionTypes.Lease;
  if (!lease || !lease.timeRange) {
    logger.error('Lease or timeRange is undefined for tenant', tenant._id);
    return { remainingIterations: 0, remainingIterationsToPay: 0 };
  }

  const timeRange = lease.timeRange;
  const remainingIterations = Math.ceil(
    moment(tenant.terminationDate || tenant.endDate).diff(
      moment(lastTerm, 'YYYYMMDDHH').startOf(timeRange),
      timeRange,
      true
    )
  );

  let remainingIterationsToPay = remainingIterations;
  const balance = _computeBalance(tenant.rents, lastTerm);

  if (balance === 0) {
    remainingIterationsToPay -= 1;
  } else if (balance > 0) {
    const nbIterationWhereRentPaid = Math.abs(balance / rentAmount);
    remainingIterationsToPay -= Math.floor(nbIterationWhereRentPaid);
  }

  return {
    remainingIterations,
    remainingIterationsToPay
  };
}

function _computeBalance(rents: CollectionTypes.PartRent[], lastTerm: number) {
  // find the rent closest to the last term
  const rent = rents.reduce((prev, curr) => {
    if (curr.term <= lastTerm) {
      return curr;
    }

    return prev;
  });

  return -rent.total.grandTotal + rent.total.payment;
}
