export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly userMessage: string;
  public readonly isOperational: boolean;

  constructor(opts: {
    code: string;
    message: string;
    userMessage: string;
    statusCode?: number;
    cause?: Error;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = 'AppError';
    this.code = opts.code;
    this.statusCode = opts.statusCode || 500;
    this.userMessage = opts.userMessage;
    this.isOperational = true;
    Error.captureStackTrace(this, AppError);
  }
}

export class SlackUserError extends AppError {
  constructor(userMessage: string, code = 'SLACK_USER_ERROR') {
    super({ code, message: userMessage, userMessage, statusCode: 400 });
    this.name = 'SlackUserError';
  }
}

export class SalesforceError extends AppError {
  constructor(
    message: string,
    opts?: { code?: string; userMessage?: string; cause?: Error },
  ) {
    super({
      code: opts?.code || 'SALESFORCE_ERROR',
      message,
      userMessage:
        opts?.userMessage ||
        'Something went wrong connecting to our system. Please try again.',
      statusCode: 502,
      cause: opts?.cause,
    });
    this.name = 'SalesforceError';
  }
}

export class AuthorizationError extends AppError {
  constructor(userMessage = 'You are not authorized to perform this action.') {
    super({
      code: 'AUTHORIZATION_ERROR',
      message: userMessage,
      userMessage,
      statusCode: 403,
    });
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    const userMessage = `${resource} was not found.`;
    super({
      code: 'NOT_FOUND',
      message: userMessage,
      userMessage,
      statusCode: 404,
    });
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(userMessage: string) {
    super({
      code: 'VALIDATION_ERROR',
      message: userMessage,
      userMessage,
      statusCode: 400,
    });
    this.name = 'ValidationError';
  }
}

export class BlockedBySalesforceCapabilityError extends AppError {
  constructor(feature: string) {
    super({
      code: 'BLOCKED_BY_EXISTING_ORG_CAPABILITY',
      message: `${feature} is not supported by existing Salesforce capability.`,
      userMessage: `The "${feature}" feature is not currently available. Our team has been notified.`,
      statusCode: 501,
    });
    this.name = 'BlockedBySalesforceCapabilityError';
  }
}

export class IdentityResolutionError extends AppError {
  constructor(opts: {
    code: string;
    message: string;
    userMessage: string;
    statusCode?: number;
    cause?: Error;
  }) {
    super(opts);
    this.name = 'IdentityResolutionError';
  }

  static notMapped(email: string): IdentityResolutionError {
    return new IdentityResolutionError({
      code: 'NOT_MAPPED',
      message: `No Distributor Account found for email: ${email}`,
      userMessage:
        'Your Slack email is not mapped to a Distributor Account in Salesforce. Please contact your admin.',
      statusCode: 404,
    });
  }

  static duplicateMapping(
    email: string,
    accountCount: number,
  ): IdentityResolutionError {
    return new IdentityResolutionError({
      code: 'DUPLICATE_MAPPING',
      message: `Email ${email} resolved to ${accountCount} Accounts — duplicate mapping`,
      userMessage:
        'Your email is linked to multiple Distributor Accounts. Please contact your admin to fix the mapping.',
      statusCode: 409,
    });
  }

  static inactiveAccount(email: string, accountId: string): IdentityResolutionError {
    return new IdentityResolutionError({
      code: 'INACTIVE_DISTRIBUTOR',
      message: `Distributor Account ${accountId} for email ${email} is inactive`,
      userMessage:
        'Your linked distributor account is not active. Please contact your administrator.',
      statusCode: 403,
    });
  }

  static emailNotAvailable(): IdentityResolutionError {
    return new IdentityResolutionError({
      code: 'EMAIL_NOT_AVAILABLE',
      message: 'Slack user email could not be resolved',
      userMessage:
        'This Slack app cannot read your email. Please ask your Slack admin to approve the users:read.email scope.',
      statusCode: 400,
    });
  }
}

export class RecordAccessForbiddenError extends AppError {
  constructor(recordType: string, recordId: string) {
    super({
      code: 'UNAUTHORIZED_RECORD_ACCESS',
      message: `User attempted to access ${recordType} ${recordId} belonging to another account`,
      userMessage: 'You do not have access to this record.',
      statusCode: 403,
    });
    this.name = 'RecordAccessForbiddenError';
  }
}
