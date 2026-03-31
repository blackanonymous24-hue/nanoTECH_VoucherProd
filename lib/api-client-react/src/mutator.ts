import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";

const apiClient = axios.create({
  baseURL: "/api",
});

export const customInstance = async <T>(
  config: AxiosRequestConfig,
  options?: AxiosRequestConfig,
): Promise<T> => {
  const response: AxiosResponse<T> = await apiClient({
    ...config,
    ...options,
  });
  return response.data;
};

export default customInstance;
