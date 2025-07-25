import * as Yup from 'yup';
import { Form, Formik } from 'formik';
import React, { useContext } from 'react';
import config from '../config';
import ErrorPage from 'next/error';
import Link from '../components/Link';
import SignInUpLayout from '../components/SignInUpLayout';
import { StoreContext } from '../store';
import { SubmitButton } from '@microrealestate/commonui/components';
import { useRouter } from 'next/router';
import useTranslation from 'next-translate/useTranslation';
import { toast } from 'sonner';

import { TextField } from '../components/formfields/TextField';
import { getLocalizedValidationSchema } from '../utils/validation';

const initialValues = {
  firstName: '',
  lastName: '',
  email: '',
  password: ''
};

export default function SignUp() {
  const { t } = useTranslation('common');

  // Create localized validation schema
  const validationSchema = getLocalizedValidationSchema(t).signUp;
  const store = useContext(StoreContext);
  const router = useRouter();

  if (!config.SIGNUP) {
    return <ErrorPage statusCode={404} />;
  }

  const signUp = async ({ firstName, lastName, email, password }) => {
    try {
      const result = await store.user.signUp(
        firstName,
        lastName,
        email,
        password
      );
      if (result.status !== 200) {
        switch (result.status) {
          case 422:
            toast.error(t('Some fields are missing'));
            return;
          case 409:
            toast.error(t('This user is already registered'));
            return;
          case 429:
            // Handle rate limiting with detailed message
            const waitTime = result.retryAfterMinutes || 60;
            toast.error(
              t('Account creation rate limit exceeded', {
                waitTime: waitTime,
                details:
                  result.details || t('Too many account creation attempts')
              }),
              {
                duration: 8000, // Show longer for rate limit messages
                description: result.details
              }
            );
            return;
          default:
            toast.error(t('Something went wrong'));
            return;
        }
      }
      router.push('/signin');
    } catch (error) {
      console.error(error);
      toast.error(t('Something went wrong'));
    }
  };

  if (store.organization.selected?.name) {
    router.push(`/${store.organization.selected.name}/dashboard`);
    return null;
  }

  return (
    <SignInUpLayout>
      <Formik
        initialValues={initialValues}
        validationSchema={validationSchema}
        onSubmit={signUp}
      >
        {({ isSubmitting }) => {
          return (
            <div className="p-5 md:p-0 md:max-w-md w-full">
              <Form className="space-y-10">
                <div className="text-2xl text-center md:text-left md:text-4xl font-medium text-secondary-foreground">
                  {t('Sign up and manage your properties online')}
                </div>
                <TextField label={t('First name')} name="firstName" />
                <TextField label={t('Last name')} name="lastName" />
                <TextField label={t('Email Address')} name="email" />
                <TextField
                  label={t('Password')}
                  name="password"
                  type="password"
                  autoComplete="current-password"
                />
                <SubmitButton
                  fullWidth
                  label={!isSubmitting ? t('Agree & Join') : t('Joining')}
                />
              </Form>
            </div>
          );
        }}
      </Formik>
      <div className="mt-10 lg:mt-0 lg:absolute lg:bottom-10 text-center text-muted-foreground w-full">
        {t('Already on {{APP_NAME}}?', {
          APP_NAME: config.APP_NAME
        })}{' '}
        <Link href="/signin" data-cy="signin">
          {t('Sign in')}
        </Link>
        .
      </div>
    </SignInUpLayout>
  );
}
