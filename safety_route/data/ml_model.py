import pandas as pd
import os
print(os.getcwd())

df = pd.read_csv("ProTego.csv")
df1 = pd.read_csv("data_police.csv")
#df = df.drop_duplicates()
df1 = df1.drop_duplicates()

#print(df.info())
print(df.head())

#print(df.describe())
print(df1.describe())

#df['column_name'].fillna(df['column_name'].mean(), inplace=True)
#df['column_name'].fillna(df['column_name'].mean(), inplace=True)

#print(df.isnull().sum())
print(df1.isnull().sum())
