import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
  ValidationPipeOptions,
} from '@nestjs/common';

function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): string[] {
  return errors.flatMap((err) => {
    const path = parentPath ? `${parentPath}.${err.property}` : err.property;

    if (err.constraints) {
      const firstMessage = Object.values(err.constraints)[0];
      return [`${path}: ${firstMessage}`];
    }

    if (err.children?.length) {
      return flattenValidationErrors(err.children, path);
    }

    return [];
  });
}

export const validationPipeConfig: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: {
    enableImplicitConversion: true,
  },
  stopAtFirstError: true,
  exceptionFactory: (errors) =>
    new BadRequestException(flattenValidationErrors(errors)),
};

export function createValidationPipe(
  overrides: Partial<ValidationPipeOptions> = {},
): ValidationPipe {
  return new ValidationPipe({ ...validationPipeConfig, ...overrides });
}
